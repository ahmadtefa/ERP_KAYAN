import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/backend/company_setup_data.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/storage/credentials_store.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/error_messages.dart';
import '../../../../shared/widgets/company_setup_form.dart';
import '../providers/auth_providers.dart';

/// Sign-in screen.
///
/// The form performs local validation only; authentication itself is always
/// decided by the API.
///
/// "Remember me" is off by default. When it is on, the username is kept for
/// the next visit — and the password only in the operating system's own
/// keystore, never in plain preferences. On the web the username alone is
/// remembered. Everything can be cleared with one tap.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _credentials = CredentialsStore();

  bool _obscure = true;
  bool _busy = false;
  bool _remember = false;
  String? _error;

  /// A brand-new installation has a database but no company and nobody who
  /// can sign in. The setup screen answers that before the sign-in form can
  /// do anything useful.
  bool? _setupNeeded;
  bool _setupBusy = false;
  String? _setupError;

  @override
  void initState() {
    super.initState();
    _loadSaved();
    _checkSetup();
  }

  Future<void> _checkSetup() async {
    try {
      final status = await ref.read(apiClientProvider).get('/setup/status');
      if (!mounted) return;
      setState(() => _setupNeeded = status['needsSetup'] == true);
    } catch (_) {
      // The server being unreachable is the sign-in form's own error to
      // report; from here, just behave as though setup is not needed.
      if (mounted) setState(() => _setupNeeded = false);
    }
  }

  Future<void> _runSetup(CompanySetupData data) async {
    setState(() {
      _setupBusy = true;
      _setupError = null;
    });
    try {
      await ref.read(apiClientProvider).post(
        '/setup/initial',
        body: {
          'companyCode': data.companyCode,
          'companyNameAr': data.companyNameAr,
          'companyNameEn': data.companyNameEn,
          if ((data.phone ?? '').isNotEmpty) 'phone': data.phone,
          if ((data.email ?? '').isNotEmpty) 'email': data.email,
          if ((data.address ?? '').isNotEmpty) 'address': data.address,
          if ((data.hqCode ?? '').isNotEmpty) 'hqCode': data.hqCode,
          if ((data.hqNameAr ?? '').isNotEmpty) 'hqNameAr': data.hqNameAr,
          if ((data.hqNameEn ?? '').isNotEmpty) 'hqNameEn': data.hqNameEn,
          if (data.logoBytes != null && data.logoBytes!.isNotEmpty)
            'logoBase64': base64Encode(data.logoBytes!),
          if (data.logoMime != null) 'logoMime': data.logoMime,
          'adminUsername': data.adminUsername,
          'adminPassword': data.adminPassword,
        },
      );
      if (!mounted) return;
      setState(() {
        _setupBusy = false;
        _setupNeeded = false;
        _username.text = data.adminUsername;
        _error = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.createdSuccessfully)),
      );
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        _setupBusy = false;
        _setupError = failure.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _setupBusy = false;
        _setupError = '$error';
      });
    }
  }

  Future<void> _loadSaved() async {
    final remembered = await _credentials.isRemembered();
    if (!mounted) return;
    if (remembered) {
      final username = await _credentials.savedUsername();
      final password = await _credentials.savedPassword();
      if (!mounted) return;
      setState(() {
        _remember = true;
        if (username != null) _username.text = username;
        if (password != null) _password.text = password;
      });
    }
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _error = null);

    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    final result = await ref
        .read(authControllerProvider.notifier)
        .signIn(username: _username.text, password: _password.text);
    if (!mounted) return;

    if (result.isSuccess) {
      // Only after the API has accepted the sign-in does anything get kept —
      // a wrong password must not be remembered.
      await _credentials.save(
        remember: _remember,
        username: _username.text.trim(),
        password: _password.text,
      );
    }

    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = result.when(
        success: (_) => null,
        failure: (failure) => localizedError(context, failure),
      );
    });
  }

  Future<void> _clearSaved() async {
    await _credentials.clear();
    if (!mounted) return;
    setState(() {
      _remember = false;
      _password.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.savedCredentialsCleared)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);

    if (_setupNeeded == true) {
      // First run on this installation: the company is set up here, before
      // anybody can sign in — and the form keeps a draft, so an interrupted
      // setup continues where it stopped.
      return Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        l10n.companySettings,
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        l10n.companySettingsHint,
                        style: theme.textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 20),
                      CompanySetupForm(
                        onSubmit: _runSetup,
                        busy: _setupBusy,
                        error: _setupError,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Icon(
                        Icons.account_balance,
                        size: 48,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        l10n.appTitle,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        l10n.signIn,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _username,
                        enabled: !_busy,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: InputDecoration(
                          labelText: l10n.username,
                          prefixIcon: const Icon(Icons.person_outline),
                        ),
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? l10n.usernameRequired
                            : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _password,
                        enabled: !_busy,
                        obscureText: _obscure,
                        autofillHints: const [AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: l10n.password,
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscure
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () =>
                                setState(() => _obscure = !_obscure),
                          ),
                        ),
                        validator: (value) => (value == null || value.isEmpty)
                            ? l10n.passwordRequired
                            : null,
                      ),
                      const SizedBox(height: 4),
                      // "Remember me": optional, off until asked for.
                      Row(
                        children: [
                          Checkbox(
                            value: _remember,
                            onChanged: _busy
                                ? null
                                : (value) =>
                                      setState(() => _remember = value ?? false),
                          ),
                          Expanded(
                            child: InkWell(
                              onTap: _busy
                                  ? null
                                  : () => setState(() => _remember = !_remember),
                              child: Text(l10n.rememberMe),
                            ),
                          ),
                          TextButton.icon(
                            onPressed: _busy ? _clearSaved : null,
                            icon: const Icon(Icons.clear_all, size: 18),
                            label: Text(l10n.clearSavedCredentials),
                          ),
                        ],
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        _ErrorBanner(message: _error!),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(l10n.signIn),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: scheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}
