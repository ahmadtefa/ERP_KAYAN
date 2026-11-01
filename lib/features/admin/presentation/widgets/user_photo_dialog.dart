import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/widgets/user_avatar.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// What the person did in the photo dialog.
enum UserPhotoOutcome { saved, removed, cancelled }

/// The limits the server enforces, repeated here so a 9-megapixel phone photo
/// is refused in the dialog instead of after a slow upload.
///
/// These are the *same numbers* as `AVATAR_LIMITS` on the server
/// (`backend/src/modules/admin/user-avatars.service.ts`); the server is still
/// the one that decides, this only saves the person a wasted round trip.
const avatarMaxBytes = 512 * 1024;
const avatarMaxDimension = 2048;
const avatarAcceptedExtensions = <String>['.png', '.jpg', '.jpeg', '.webp'];

/// Picks a photo, previews it, and uploads it on confirmation.
///
/// The dialog is a *preview first* flow on purpose: the brief asks for a
/// preview before saving, and uploading straight from the file chooser gives a
/// person no chance to see that they picked the wrong photograph.
class UserPhotoDialog extends ConsumerStatefulWidget {
  const UserPhotoDialog({
    super.key,
    required this.userId,
    required this.userName,
    required this.hasPhoto,
    this.isSelf = false,
  });

  final String userId;
  final String userName;
  final bool hasPhoto;

  /// Whether this is the signed-in person's own photo: the wording differs, and
  /// nothing else does.
  final bool isSelf;

  @override
  ConsumerState<UserPhotoDialog> createState() => _UserPhotoDialogState();
}

class _UserPhotoDialogState extends ConsumerState<UserPhotoDialog> {
  PickedFile? _picked;
  bool _busy = false;
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  Future<void> _choose() async {
    setState(() => _error = null);
    final file = await pickFile(extensions: avatarAcceptedExtensions);
    if (file == null || !mounted) return;

    final extension = file.name.contains('.')
        ? '.${file.name.split('.').last.toLowerCase()}'
        : '';
    if (!avatarAcceptedExtensions.contains(extension)) {
      setState(
        () => _error = _t(
          'الملف «${file.name}» ليس صورة مدعومة. المسموح: PNG أو JPG أو WebP.',
          '“${file.name}” is not a supported image. Use PNG, JPG or WebP.',
        ),
      );
      return;
    }
    if (file.bytes.isEmpty) {
      setState(() => _error = _t('الملف فارغ.', 'The file is empty.'));
      return;
    }
    if (file.bytes.length > avatarMaxBytes) {
      setState(
        () => _error = _t(
          'حجم الصورة ${(file.bytes.length / 1024).round()} كيلوبايت، والحد '
              '${avatarMaxBytes ~/ 1024} كيلوبايت. اختر صورة أصغر.',
          'The image is ${(file.bytes.length / 1024).round()} KB; the limit is '
              '${avatarMaxBytes ~/ 1024} KB. Choose a smaller one.',
        ),
      );
      return;
    }
    setState(() => _picked = file);
  }

  Future<void> _save() async {
    final file = _picked;
    if (file == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    // The declared type travels with the bytes only as a hint; the server
    // decides from the content itself and refuses a mismatch.
    final mime = switch (file.name.split('.').last.toLowerCase()) {
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      _ => 'application/octet-stream',
    };

    try {
      await ref
          .read(apiClientProvider)
          .uploadFile(
            '/users/${widget.userId}/avatar',
            field: 'file',
            filename: file.name,
            bytes: Uint8List.fromList(file.bytes),
            contentType: mime,
          );
      ref.read(avatarRevisionProvider.notifier).bump();
      // The signed-in person's own photo also lives in the session object, so
      // the top bar stops asking for an image that is no longer there.
      await ref.read(authControllerProvider.notifier).refreshAvatarState();
      if (mounted) Navigator.of(context).pop(UserPhotoOutcome.saved);
    } on Failure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t('حذف الصورة', 'Remove the photo')),
        content: Text(
          _t(
            'سيظهر الحرف الأول من الاسم بدل الصورة. الحساب لا يتأثر.',
            'The first letter of the name will be shown instead. The account '
                'is not affected.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_t('حذف', 'Remove')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .delete('/users/${widget.userId}/avatar');
      ref.read(avatarRevisionProvider.notifier).bump();
      await ref.read(authControllerProvider.notifier).refreshAvatarState();
      if (mounted) Navigator.of(context).pop(UserPhotoOutcome.removed);
    } on Failure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const previewSize = 96.0;

    final preview = _picked != null
        ? ClipOval(
            child: Image.memory(
              Uint8List.fromList(_picked!.bytes),
              width: previewSize,
              height: previewSize,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined),
            ),
          )
        : UserAvatar(
            userId: widget.userId,
            name: widget.userName,
            hasPhoto: widget.hasPhoto,
            size: previewSize,
          );

    return AlertDialog(
      title: Text(
        widget.isSelf
            ? _t('صورتي', 'My photo')
            : _t('الصورة الشخصية — ${widget.userName}', 'Photo — ${widget.userName}'),
      ),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(child: preview),
            const SizedBox(height: AppSpacing.md),
            if (_picked != null)
              Text(
                _t(
                  'معاينة قبل الحفظ: ${_picked!.name}',
                  'Preview before saving: ${_picked!.name}',
                ),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              )
            else
              Text(
                widget.hasPhoto
                    ? _t(
                        'هذه هي الصورة الحالية.',
                        'This is the current photo.',
                      )
                    : _t(
                        'لا توجد صورة بعد؛ يظهر الحرف الأول من الاسم.',
                        'There is no photo yet; the initial letter is shown.',
                      ),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            const SizedBox(height: AppSpacing.md),
            Text(
              _t(
                'PNG أو JPG أو WebP — حتى ${avatarMaxBytes ~/ 1024} كيلوبايت '
                    'و$avatarMaxDimension بكسل لكل ضلع.',
                'PNG, JPG or WebP — up to ${avatarMaxBytes ~/ 1024} KB and '
                    '$avatarMaxDimension px a side.',
              ),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppTone.danger.backgroundOn(
                    Theme.of(context).brightness,
                  ),
                  borderRadius: AppRadii.control,
                ),
                child: Text(
                  _error!,
                  style: TextStyle(color: AppTone.danger.foregroundOn(
                    Theme.of(context).brightness,
                  )),
                ),
              ),
            ],
            if (_busy) ...[
              const SizedBox(height: AppSpacing.md),
              const LinearProgressIndicator(minHeight: 3),
            ],
          ],
        ),
      ),
      actions: [
        if (widget.hasPhoto)
          TextButton(
            onPressed: _busy ? null : _remove,
            child: Text(_t('حذف الصورة', 'Remove photo')),
          ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: Text(_t('إلغاء', 'Cancel')),
        ),
        OutlinedButton.icon(
          onPressed: _busy ? null : _choose,
          icon: const Icon(Icons.folder_open_outlined, size: 18),
          label: Text(
            _picked == null
                ? _t('اختيار صورة', 'Choose a photo')
                : _t('اختيار صورة أخرى', 'Choose another'),
          ),
        ),
        FilledButton.icon(
          onPressed: _busy || _picked == null ? null : _save,
          icon: const Icon(Icons.check, size: 18),
          label: Text(_t('حفظ الصورة', 'Save photo')),
        ),
      ],
    );
  }
}

/// Opens the dialog and reports what happened.
///
/// The dialog is a `ConsumerStatefulWidget`, so it reads and writes the session
/// itself; the caller only has to say whose photo it is.
Future<UserPhotoOutcome> showUserPhotoDialog(
  BuildContext context, {
  required String userId,
  required String userName,
  required bool hasPhoto,
  bool isSelf = false,
}) async {
  final outcome = await showDialog<UserPhotoOutcome>(
    context: context,
    barrierDismissible: false,
    builder: (_) => UserPhotoDialog(
      userId: userId,
      userName: userName,
      hasPhoto: hasPhoto,
      isSelf: isSelf,
    ),
  );
  return outcome ?? UserPhotoOutcome.cancelled;
}
