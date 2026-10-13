import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/backend/company_setup_data.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/error_messages.dart';
import '../../../../shared/widgets/company_logo.dart';
import '../../../../shared/widgets/company_setup_form.dart';
import '../providers/auth_providers.dart';

/// Sign-in screen.
///
/// The form performs local validation only; authentication itself is always
/// decided by the API. "Remember me" is opt-in and stored through [TokenStore]
/// (the password only in secure storage). On a brand-new installation with no
/// company yet, the company setup form is shown before the sign-in form.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();

  bool _obscure = true;
  bool _rememberLogin = false;
  bool _rememberLoaded = false;
  bool _busy = false;
  String? _error;

  /// A brand-new installation has a database but no company and nobody who
  /// can sign in. The setup form answers that before the sign-in form.
  bool? _setupNeeded;
  bool _setupBusy = false;
  String? _setupError;

  @override
  void initState() {
    super.initState();
    _restoreRememberedLogin();
    _checkSetup();
  }

  Future<void> _checkSetup() async {
    try {
      final status = await ref.read(apiClientProvider).get('/setup/status');
      if (!mounted) return;
      setState(() => _setupNeeded = status['needsSetup'] == true);
    } catch (_) {
      // Server unreachable is reported by the sign-in form itself.
      if (mounted) setState(() => _setupNeeded = false);
    }
  }


  Future<void> _restoreRememberedLogin() async {
    final store = ref.read(tokenStoreProvider);
    final enabled = await store.rememberLoginEnabled();
    final username = enabled ? await store.readRememberedUsername() : null;
    final password = enabled ? await store.readRememberedPassword() : null;
    if (!mounted) return;
    setState(() {
      _rememberLogin = enabled;
      _rememberLoaded = true;
      _username.text = username ?? '';
      _password.text = password ?? '';
    });
  }

  Future<void> _runSetup(CompanySetupData data) async {
    setState(() {
      _setupBusy = true;
      _setupError = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '/setup/initial',
            body: {
              'companyCode': data.companyCode,
              'companyNameAr': data.companyNameAr,
              'companyNameEn': data.companyNameEn,
              'facilityKind': data.facilityKind,
              if ((data.phone ?? '').isNotEmpty) 'phone': data.phone,
              if ((data.email ?? '').isNotEmpty) 'email': data.email,
              if ((data.address ?? '').isNotEmpty) 'address': data.address,
              if ((data.hqCode ?? '').isNotEmpty) ...{
                'hqCode': data.hqCode,
                'unitCode': data.hqCode,
              },
              if ((data.hqNameAr ?? '').isNotEmpty) ...{
                'hqNameAr': data.hqNameAr,
                'unitNameAr': data.hqNameAr,
              },
              if ((data.hqNameEn ?? '').isNotEmpty) ...{
                'hqNameEn': data.hqNameEn,
                'unitNameEn': data.hqNameEn,
              },
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.createdSuccessfully)));
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
        .signIn(
          username: _username.text,
          password: _password.text,
          rememberLogin: _rememberLogin,
        );
    if (!mounted) return;

    setState(() {
      _busy = false;
      _error = result.when(
        success: (_) => null,
        failure: (failure) => localizedError(context, failure),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final branding = ref.watch(companyBrandingProvider).value;
    final logoPath = branding?['logoUrl'] as String?;
    final localizedCompanyName = branding == null
        ? null
        : (Localizations.localeOf(context).languageCode == 'ar'
                  ? branding['nameAr']
                  : branding['nameEn'])
              ?.toString();
    final logoUrl = logoPath == null
        ? null
        : '${ref.watch(appConfigProvider).apiBaseUrl.replaceFirst(RegExp(r'/+$'), '')}$logoPath';

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
                      Center(child: CompanyLogo(url: logoUrl, size: 56)),
                      const SizedBox(height: 12),
                      Text(
                        localizedCompanyName?.trim().isNotEmpty == true
                            ? localizedCompanyName!
                            : l10n.appTitle,
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
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: _rememberLogin,
                        onChanged: !_rememberLoaded || _busy
                            ? null
                            : (value) async {
                                final enabled = value ?? false;
                                setState(() => _rememberLogin = enabled);
                                if (!enabled) {
                                  await ref
                                      .read(tokenStoreProvider)
                                      .clearRememberedLogin();
                                }
                              },
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text(l10n.rememberLogin),
                        subtitle: Text(
                          kIsWeb
                              ? l10n.rememberWebUsernameOnly
                              : l10n.rememberNativeSecure,
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        _ErrorBanner(message: _error!),
                      ],
                      const SizedBox(height: 8),
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
