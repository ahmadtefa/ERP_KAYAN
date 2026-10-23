import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../core/error/failure.dart';
import '../../core/platform/browser_actions.dart';
import '../extensions/l10n_extension.dart';
import 'app_error_dialog.dart';

/// Fetches a file and says what happened.
///
/// Every download in the program goes through here, so none of them can
/// claim success before the bytes are on their way: the future only
/// completes once the platform has handed the file over, and a refusal from
/// the server is shown as the server worded it.
///
/// The [onStart] and [onDone] callbacks let the button that started this
/// show that it is working, which is the difference between "nothing
/// happened" and "wait a moment" on a slow machine.
Future<void> runDownload(
  BuildContext context,
  Future<DownloadRequest> request, {
  VoidCallback? onStart,
  VoidCallback? onDone,
}) async {
  onStart?.call();
  try {
    await downloadFile(await request);
    if (!context.mounted) return;
    _say(context, context.l10n.downloadStarted, isError: false);
  } catch (error) {
    if (!context.mounted) return;
    _say(
      context,
      _message(error),
      isError: true,
      statusCode: error is DioException ? error.response?.statusCode : null,
    );
  } finally {
    onDone?.call();
  }
}

/// Opens a print page in a new tab, and says so.
///
/// A popup blocker can refuse the tab. There is no way to detect that from
/// here - `window.open` simply answers null - so the message names what to
/// do about it rather than pretending the page is on its way.
Future<void> runPrint(
  BuildContext context,
  Future<String> link, {
  VoidCallback? onStart,
  VoidCallback? onDone,
}) async {
  onStart?.call();
  try {
    final url = await link;
    if (!context.mounted) return;
    openInNewTab(url);
    _say(context, context.l10n.printOpened, isError: false);
  } catch (error) {
    if (!context.mounted) return;
    _say(
      context,
      _message(error),
      isError: true,
      statusCode: error is DioException ? error.response?.statusCode : null,
    );
  } finally {
    onDone?.call();
  }
}

/// The server's own sentence where there is one, and never a raw stack.
String _message(Object error) {
  if (error is Failure) return error.message;
  if (error is DownloadFailure) return error.message;
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['detail'] is String) {
      return data['detail'] as String;
    }
    if (error.type == DioExceptionType.connectionError) {
      return 'The server could not be reached.';
    }
  }
  return error.toString();
}

void _say(
  BuildContext context,
  String message, {
  required bool isError,
  int? statusCode,
}) {
  // A failed download is an error: it is not a note to glance at on the way
  // to something else, and its reason (no permission, server unreachable)
  // has to be read. Successes stay as a light note at the bottom.
  if (isError) {
    showAppError(context, message, statusCode: statusCode);
    return;
  }
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Row(
        children: [
          Icon(
            isError ? Icons.error_outline : Icons.download_done_outlined,
            color: isError ? scheme.onErrorContainer : scheme.onPrimaryContainer,
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(message)),
        ],
      ),
      backgroundColor: isError
          ? scheme.errorContainer
          : scheme.primaryContainer,
      duration: Duration(seconds: isError ? 10 : 4),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
