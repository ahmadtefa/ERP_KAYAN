import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/image/company_logo_image.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../providers/auth_providers.dart';

typedef PhotoScope = ({String companyId, String userId});

/// The picker is injectable for widget tests; no file is saved in preferences.
final userPhotoPickerProvider = Provider<Future<PickedFile?> Function()>((ref) =>
    () => pickFile(extensions: ['.png', '.jpg', '.jpeg', '.webp']));
final userPhotoNormalizerProvider = Provider<Future<Uint8List> Function(Uint8List)>((ref) => normalizeCompanyLogo);

/// Separate keys prevent cached data from one account or company appearing in
/// another. The server also verifies expectedUserId against the live session.
final userPhotoProvider = FutureProvider.autoDispose.family<Uint8List?, PhotoScope>((ref, scope) async {
  final user = ref.watch(currentUserProvider);
  if (user == null || user.id != scope.userId || user.companyId != scope.companyId) return null;
  final data = await ref.watch(apiClientProvider).getObject('/profile/photo',query:{'expectedUserId':scope.userId});
  if (data['data'] == null) return null;
  if (data['mime'] != 'image/webp' || data['data'] is! String) throw const FormatException('Invalid photo response');
  final encoded = data['data'] as String;
  if (encoded.length > 3 * 1024 * 1024) throw const FormatException('Photo response too large');
  return base64Decode(encoded);
});

class UserPhotoCard extends ConsumerStatefulWidget {
  const UserPhotoCard({super.key});
  @override
  ConsumerState<UserPhotoCard> createState() => _UserPhotoCardState();
}

class _UserPhotoCardState extends ConsumerState<UserPhotoCard> {
  bool _busy = false;
  String _label(String ar, String en) => Localizations.localeOf(context).languageCode == 'ar' ? ar : en;
  bool _same(PhotoScope scope) {
    final user = ref.read(currentUserProvider);
    return user != null && user.id == scope.userId && user.companyId == scope.companyId;
  }

  Future<void> _upload(PhotoScope scope) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final picked = await ref.read(userPhotoPickerProvider)();
      if (picked == null || !mounted || !_same(scope)) return;
      final data = await ref.read(userPhotoNormalizerProvider)(picked.bytes);
      if (!mounted || !_same(scope)) return;
      final form = FormData.fromMap({'expectedUserId':scope.userId,
        'file':MultipartFile.fromBytes(data,filename:'profile-photo.png')});
      await ref.read(apiClientProvider).post('/profile/photo',body:form);
      if (mounted && _same(scope)) ref.invalidate(userPhotoProvider(scope));
    } catch (error) {
      if (mounted) await showAppError(context,error);
    } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _remove(PhotoScope scope) async {
    if (_busy || !_same(scope)) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).delete('/profile/photo?expectedUserId=${Uri.encodeQueryComponent(scope.userId)}');
      if (mounted && _same(scope)) ref.invalidate(userPhotoProvider(scope));
    } catch (error) {
      if (mounted) await showAppError(context,error);
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    if (user == null) return const SizedBox.shrink();
    final scope = (companyId:user.companyId,userId:user.id);
    final photo = ref.watch(userPhotoProvider(scope));
    final bytes = photo.asData?.value;
    return Card(child: Padding(padding:const EdgeInsets.all(16),child:Wrap(spacing:16,runSpacing:8,
      crossAxisAlignment:WrapCrossAlignment.center,children:[
        CircleAvatar(radius:28,child:bytes == null ? const Icon(Icons.person_outline) : ClipOval(
          child:Image.memory(bytes,width:56,height:56,fit:BoxFit.cover,errorBuilder:(_, _, _) => const Icon(Icons.person_outline)))),
        Text(_label('صورة المستخدم','User photo')),
        OutlinedButton.icon(key:const Key('user-photo-upload'),onPressed:_busy ? null : () => _upload(scope),
          icon:const Icon(Icons.photo_camera_outlined),label:Text(_label('اختيار صورة','Choose photo'))),
        if (bytes != null) TextButton(key:const Key('user-photo-remove'),onPressed:_busy ? null : () => _remove(scope),
          child:Text(_label('حذف الصورة','Remove photo'))),
        if (photo.hasError) TextButton(onPressed:() => ref.invalidate(userPhotoProvider(scope)),child:Text(_label('إعادة المحاولة','Retry'))),
        if (_busy || photo.isLoading) const SizedBox(width:20,height:20,child:CircularProgressIndicator(strokeWidth:2)),
      ])));
  }
}
