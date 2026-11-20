import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

final _opsAutoCreateRan = Expando<bool>('opsAutoCreateRan');

/// True when the screen was opened with `?new=1` from an operations centre,
/// i.e. the caller asked for the blank new-record form, not the list.
bool opsAutoCreateRequested(BuildContext context) =>
    opsAutoCreateValue(context, 'new') == '1';

/// Reads a centre-provided form selector without coupling a screen to a route.
String? opsAutoCreateValue(BuildContext context, String key) {
  try {
    return GoRouterState.of(context).uri.queryParameters[key];
  } catch (_) {
    return null;
  }
}

/// Run [openForm] once after the first frame when the route carries `?new=1`.
///
/// The flag is one-shot per screen state, so closing the form and returning to
/// the list does not immediately reopen it.
void opsRunAutoCreate(State state, VoidCallback openForm) {
  if (_opsAutoCreateRan[state] == true) return;
  if (!state.mounted || !opsAutoCreateRequested(state.context)) return;
  _opsAutoCreateRan[state] = true;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!state.mounted) return;
    openForm();
  });
}
