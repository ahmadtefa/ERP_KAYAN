import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/backend/company_setup_data.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/storage/credentials_store.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/error_messages.dart';
import '../../../../shared/widgets/company_setup_form.dart';
import '../../../../shared/widgets/surface_card.dart';
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
      _username.clear();
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
        backgroundColor: theme.colorScheme.surface,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.xxl),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 660),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _AuthBrandMark(compact: true),
                    const SizedBox(height: AppSpacing.xxl),
                    SurfaceCard(
                      title: l10n.companySettings,
                      subtitle: l10n.companySettingsHint,
                      icon: Icons.domain_add_outlined,
                      padding: const EdgeInsets.all(AppSpacing.xxl),
                      child: CompanySetupForm(
                        onSubmit: _runSetup,
                        busy: _setupBusy,
                        error: _setupError,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    final form = _SignInForm(
      formKey: _formKey,
      username: _username,
      password: _password,
      obscure: _obscure,
      busy: _busy,
      remember: _remember,
      error: _error,
      onToggleObscure: () => setState(() => _obscure = !_obscure),
      onToggleRemember: _busy
          ? null
          : (value) => setState(() => _remember = value),
      onClearSaved: _busy ? null : _clearSaved,
      onSubmit: _busy ? null : _submit,
    );

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 960;
          if (!wide) {
            return SafeArea(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _AuthBrandCompact(),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xxl,
                        vertical: AppSpacing.xxxl,
                      ),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 420),
                          child: form,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: (constraints.maxWidth * 0.44).clamp(380.0, 620.0),
                child: const _AuthBrandPanel(),
              ),
              Expanded(
                child: SafeArea(
                  child: Center(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(AppSpacing.xxxl),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 400),
                        child: form,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The credentials form, shared by the wide and narrow layouts. It only
/// lays the fields out; validation and authentication stay in the state
/// object above.
class _SignInForm extends StatelessWidget {
  const _SignInForm({
    required this.formKey,
    required this.username,
    required this.password,
    required this.obscure,
    required this.busy,
    required this.remember,
    required this.error,
    required this.onToggleObscure,
    required this.onToggleRemember,
    required this.onClearSaved,
    required this.onSubmit,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController username;
  final TextEditingController password;
  final bool obscure;
  final bool busy;
  final bool remember;
  final String? error;
  final VoidCallback onToggleObscure;
  final ValueChanged<bool>? onToggleRemember;
  final VoidCallback? onClearSaved;
  final VoidCallback? onSubmit;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Form(
      key: formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.signIn,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            l10n.welcomeBack,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.xxl),
          TextFormField(
            controller: username,
            enabled: !busy,
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
          const SizedBox(height: AppSpacing.md),
          TextFormField(
            controller: password,
            enabled: !busy,
            obscureText: obscure,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => onSubmit?.call(),
            decoration: InputDecoration(
              labelText: l10n.password,
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                tooltip: l10n.password,
                icon: Icon(
                  obscure
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
                onPressed: busy ? null : onToggleObscure,
              ),
            ),
            validator: (value) =>
                (value == null || value.isEmpty) ? l10n.passwordRequired : null,
          ),
          const SizedBox(height: AppSpacing.sm),
          // "Remember me": optional, off until asked for.
          Row(
            children: [
              Checkbox(
                value: remember,
                onChanged: onToggleRemember == null
                    ? null
                    : (value) => onToggleRemember!(value ?? false),
              ),
              Expanded(
                child: InkWell(
                  onTap: onToggleRemember == null
                      ? null
                      : () => onToggleRemember!(!remember),
                  child: Text(l10n.rememberMe, style: theme.textTheme.bodySmall),
                ),
              ),
              TextButton.icon(
                onPressed: onClearSaved,
                icon: const Icon(Icons.clear_all, size: 16),
                label: Text(l10n.clearSavedCredentials),
              ),
            ],
          ),
          if (error != null) ...[
            const SizedBox(height: AppSpacing.md),
            _ErrorBanner(message: error!),
          ],
          const SizedBox(height: AppSpacing.xl),
          FilledButton(
            onPressed: onSubmit,
            child: busy
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.signIn),
          ),
        ],
      ),
    );
  }
}

/// Full-height navy brand panel for wide windows.
class _AuthBrandPanel extends StatelessWidget {
  const _AuthBrandPanel();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = context.l10n;
    final features = <(IconData, String)>[
      (Icons.space_dashboard_outlined, l10n.dashboard),
      (Icons.receipt_long_outlined, l10n.sales),
      (Icons.shopping_bag_outlined, l10n.purchases),
      (Icons.inventory_2_outlined, l10n.inventory),
      (Icons.query_stats_outlined, l10n.reports),
    ];
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: AppGradients.brand),
      child: Stack(
        children: [
          const Positioned.fill(child: _BrandBackdrop()),
          Padding(
            padding: const EdgeInsets.fromLTRB(48, 56, 48, 40),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _AuthBrandMark(onDark: true),
                const Spacer(),
                Text(
                  l10n.appTitle,
                  style: theme.textTheme.headlineMedium?.copyWith(
                    color: AppColors.onNavy,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                SizedBox(
                  width: 320,
                  child: Text(
                    l10n.welcomeBack,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppColors.onNavyMuted,
                      height: 1.6,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxxl),
                for (final (icon, label) in features)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: Row(
                      children: [
                        Icon(icon, size: 17, color: AppColors.onNavyMuted),
                        const SizedBox(width: AppSpacing.md),
                        Text(
                          label,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: AppColors.onNavy,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Narrow-window header: the same identity in a single strip.
class _AuthBrandCompact extends StatelessWidget {
  const _AuthBrandCompact();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.navy,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xxl,
        vertical: AppSpacing.xxl,
      ),
      child: const _AuthBrandMark(onDark: true),
    );
  }
}

/// The KAYAN mark and wordmark.
class _AuthBrandMark extends StatelessWidget {
  const _AuthBrandMark({this.onDark = false, this.compact = false});

  final bool onDark;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = context.l10n;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: compact ? 40 : 44,
          height: compact ? 40 : 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: onDark ? AppColors.primary : AppColors.navy,
            borderRadius: BorderRadius.circular(AppRadii.lg),
          ),
          child: Text(
            'K',
            style: theme.textTheme.titleLarge?.copyWith(
              color: AppColors.onNavy,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.appTitle,
              style: theme.textTheme.titleMedium?.copyWith(
                color: onDark
                    ? AppColors.onNavy
                    : theme.colorScheme.onSurface,
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(
              'ERP',
              style: theme.textTheme.labelSmall?.copyWith(
                color: onDark
                    ? AppColors.onNavyMuted
                    : theme.colorScheme.onSurfaceVariant,
                letterSpacing: 1.6,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Two very quiet curves behind the brand copy — nothing that competes with
/// the form or implies data that does not exist.
class _BrandBackdrop extends StatelessWidget {
  const _BrandBackdrop();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: _BrandBackdropPainter());
  }
}

class _BrandBackdropPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = AppColors.accent.withValues(alpha: 0.10)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final fill = Paint()
      ..color = AppColors.accent.withValues(alpha: 0.05)
      ..style = PaintingStyle.fill;
    final center = Offset(size.width * 0.92, size.height * 0.18);
    for (var i = 1; i <= 4; i += 1) {
      canvas.drawCircle(center, 60.0 * i, stroke);
    }
    canvas.drawCircle(center, 60, fill);
    canvas.drawLine(
      Offset(0, size.height * 0.78),
      Offset(size.width, size.height * 0.62),
      stroke,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.errorSoft,
        borderRadius: AppRadii.control,
        border: Border.all(color: AppColors.error.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline,
            size: 18,
            color: AppColors.error,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppColors.error,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
