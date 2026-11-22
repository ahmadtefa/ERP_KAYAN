import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/image/company_logo_image.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/item_image_data_source.dart';

/// A small square picture for an item, with a neutral placeholder when it has
/// none. Used on the catalogue row and anywhere a picker shows items.
class ItemThumbnail extends StatelessWidget {
  const ItemThumbnail({
    super.key,
    required this.bytes,
    this.size = 32,
    this.fallbackIcon = Icons.inventory_2_outlined,
  });

  final Uint8List? bytes;
  final double size;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    final data = bytes;
    return SizedBox(
      width: size,
      height: size,
      child: data == null
          ? Icon(fallbackIcon, size: size * 0.7, color: Theme.of(context).hintColor)
          : ClipRRect(
              borderRadius: BorderRadius.circular(size * 0.18),
              child: Image.memory(
                data,
                width: size,
                height: size,
                fit: BoxFit.cover,
                // A corrupted or undecodable picture must never take the row
                // down with it; the placeholder is the honest fallback.
                errorBuilder: (_, _, _) =>
                    Icon(fallbackIcon, size: size * 0.7, color: Theme.of(context).hintColor),
              ),
            ),
    );
  }
}

/// The picture section of the item editor: shows the current picture and lets
/// the user replace or remove it.
///
/// The choices the server makes (format, size, dimensions) are not repeated
/// here — one authority for validation means one set of messages to translate.
class ItemPictureEditor extends ConsumerStatefulWidget {
  const ItemPictureEditor({super.key, required this.itemId, this.enabled = true});

  final String itemId;
  final bool enabled;

  @override
  ConsumerState<ItemPictureEditor> createState() => _ItemPictureEditorState();
}

class _ItemPictureEditorState extends ConsumerState<ItemPictureEditor> {
  Uint8List? _bytes;
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final image =
          await ItemImageDataSource(ref.read(apiClientProvider)).fetch(widget.itemId);
      if (!mounted) return;
      setState(() {
        _bytes = image.data == null ? null : Uint8List.fromList(image.data!);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _pick() async {
    if (_busy || !widget.enabled) return;
    setState(() => _busy = true);
    var sent = false;
    try {
      final picked = await pickFile(extensions: const ['.png', '.jpg', '.jpeg', '.webp']);
      if (picked == null || !mounted) return;
      // Shrink before sending so a phone photo does not hit the upload cap
      // for no reason; the server validates again regardless.
      final prepared = await normalizeCompanyLogo(picked.bytes);
      if (!mounted) return;
      final client = ItemImageDataSource(ref.read(apiClientProvider));
      sent = true;
      final saved = await client.upload(
        widget.itemId,
        PickedFile(name: 'item.png', bytes: prepared, mimeType: 'image/png'),
      );
      if (!mounted) return;
      setState(() {
        _bytes = saved.data == null ? null : Uint8List.fromList(saved.data!);
        _error = null;
      });
    } catch (error) {
      // The upload may have committed before the response was lost; re-read so
      // the screen shows what the server actually holds.
      if (sent && mounted) await _load();
      if (mounted) await showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    if (_busy || !widget.enabled || _bytes == null) return;
    setState(() => _busy = true);
    try {
      await ItemImageDataSource(ref.read(apiClientProvider)).remove(widget.itemId);
      if (mounted) setState(() => _bytes = null);
    } catch (error) {
      // Deletion may also have committed before the response was lost.
      if (mounted) await _load();
      if (mounted) await showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 64,
              height: 64,
              child: _loading
                  ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                  : ItemThumbnail(bytes: _bytes, size: 64),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_t('صورة الصنف', 'Item picture'),
                      style: Theme.of(context).textTheme.titleSmall),
                  if (_error != null)
                    Text(
                      _t('تعذّر تحميل الصورة', 'The picture could not be loaded'),
                      style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
                    ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 8,
                    children: [
                      OutlinedButton.icon(
                        key: const Key('item-image-choose'),
                        onPressed: _busy || !widget.enabled ? null : _pick,
                        icon: const Icon(Icons.photo_camera_outlined, size: 18),
                        label: Text(_bytes == null
                            ? _t('إضافة صورة', 'Add picture')
                            : _t('تغيير الصورة', 'Change picture')),
                      ),
                      if (_bytes != null)
                        TextButton(
                          key: const Key('item-image-remove'),
                          onPressed: _busy || !widget.enabled ? null : _remove,
                          child: Text(_t('حذف الصورة', 'Remove picture')),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (_busy)
              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          ],
        ),
      ),
    );
  }
}
