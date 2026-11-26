import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';

/// The bytes of a company mark, fetched through the API client so the request
/// carries the signed-in session (and is renewed with it). The server only
/// serves a company's own mark to its own people, so a plain network image,
/// which cannot send the session, would be refused. Null when there is no
/// mark or it cannot be read; the caller shows its fallback.
final companyLogoBytesProvider =
    FutureProvider.autoDispose.family<Uint8List?, String>((ref, url) async {
  if (url.isEmpty) return null;
  try {
    final response = await ref.read(apiClientProvider).raw.get<List<int>>(
          url,
          options: Options(responseType: ResponseType.bytes),
        );
    final data = response.data;
    if (data == null || data.isEmpty) return null;
    return Uint8List.fromList(data);
  } on Object {
    return null;
  }
});

/// Shows a company mark from [url] with the session attached. Shows
/// [fallback] while loading, when there is no mark, and when it fails.
class AuthorizedCompanyLogo extends ConsumerWidget {
  const AuthorizedCompanyLogo({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.contain,
    this.fallback = const SizedBox.shrink(),
  });

  final String? url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Widget fallback;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final address = url;
    if (address == null || address.isEmpty) return fallback;
    final bytes = ref.watch(companyLogoBytesProvider(address)).asData?.value;
    if (bytes == null) return fallback;
    return Image.memory(
      bytes,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (context, error, stackTrace) => fallback,
    );
  }
}
