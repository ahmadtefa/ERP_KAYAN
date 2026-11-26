import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/backend/company_setup_data.dart';
import '../../core/image/company_logo_image.dart';
import '../../core/platform/browser_actions.dart';
import '../../core/platform/picked_file.dart';

/// The first-run setup form: company, headquarters, optional logo, and the
/// first administrator — on one screen, in both languages.
///
/// The labels are deliberately written in Arabic and English together: this
/// is the one screen that appears before anybody can sign in, and it must be
/// readable by whoever is standing in front of the machine, whatever the
/// program language is set to.
///
/// What the person types is kept as a local draft as they type — so if the
/// setup is interrupted (closed window, power cut), reopening the program
/// brings the same values back and the setup can be completed. Passwords are
/// never part of the draft: they are not written to disk at any point before
/// the account exists.
class CompanySetupForm extends StatefulWidget {
  const CompanySetupForm({
    super.key,
    required this.onSubmit,
    this.submitLabel = 'إنشاء الحساب والبدء / Create and start',
    this.busy = false,
    this.error,
    this.fieldErrors = const {},
  });

  /// Called with everything collected, after the form's own validation.
  final Future<void> Function(CompanySetupData data) onSubmit;

  final String submitLabel;
  final bool busy;

  /// After a reset the installation keeps its administrator. Setup then asks
  /// for that account's CURRENT username and password, not for new ones.
  final String? error;
  final Map<String, String> fieldErrors;

  @override
  State<CompanySetupForm> createState() => _CompanySetupFormState();
}

class _CompanySetupFormState extends State<CompanySetupForm> {
  static const _draftKey = 'firstRunSetup.draft.v1';

  final _companyCode = TextEditingController();
  final _companyNameAr = TextEditingController();
  final _companyNameEn = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _hqCode = TextEditingController();
  final _hqNameAr = TextEditingController();
  final _hqNameEn = TextEditingController();
  final _adminUsername = TextEditingController();
  final _adminPassword = TextEditingController();
  final _adminAgain = TextEditingController();

  PickedFile? _logo;
  String _facilityKind = 'HEADQUARTERS';
  bool _obscure = true;
  String? _localError;
  final _fieldErrors = <String, String>{};
  void _clearField(String key) {
    if (_fieldErrors.remove(key) != null) setState(() {});
  }

  @override
  void didUpdateWidget(covariant CompanySetupForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(widget.fieldErrors, oldWidget.fieldErrors)) {
      _fieldErrors..clear()..addAll(widget.fieldErrors);
    }
  }

  @override
  void initState() {
    super.initState();
    _fieldErrors.addAll(widget.fieldErrors);
    _restoreDraft();
    for (final controller in [
      _companyCode,
      _companyNameAr,
      _companyNameEn,
      _phone,
      _email,
      _address,
      _hqCode,
      _hqNameAr,
      _hqNameEn,
      _adminUsername,
    ]) {
      controller.addListener(_saveDraft);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _companyCode,
      _companyNameAr,
      _companyNameEn,
      _phone,
      _email,
      _address,
      _hqCode,
      _hqNameAr,
      _hqNameEn,
      _adminUsername,
      _adminPassword,
      _adminAgain,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  /// Brings back what an interrupted setup had already typed. The draft
  /// holds names and contact details only — never a password.
  Future<void> _restoreDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_draftKey);
      if (raw == null || raw.isEmpty) return;
      final draft = jsonDecode(raw) as Map<String, dynamic>;
      void fill(TextEditingController c, String key) {
        final value = draft[key];
        if (value is String && value.isNotEmpty) c.text = value;
      }

      fill(_companyCode, 'companyCode');
      fill(_companyNameAr, 'companyNameAr');
      fill(_companyNameEn, 'companyNameEn');
      fill(_phone, 'phone');
      fill(_email, 'email');
      fill(_address, 'address');
      fill(_hqCode, 'hqCode');
      fill(_hqNameAr, 'hqNameAr');
      fill(_hqNameEn, 'hqNameEn');
      fill(_adminUsername, 'adminUsername');
      final kind = draft['facilityKind'];
      if (kind is String && (kind == 'HEADQUARTERS' || kind == 'BRANCH')) {
        _facilityKind = kind;
      }
      if (mounted) setState(() {});
    } catch (_) {
      // A damaged draft is not a reason to block the setup.
    }
  }

  Future<void> _saveDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _draftKey,
        jsonEncode({
          'companyCode': _companyCode.text,
          'companyNameAr': _companyNameAr.text,
          'companyNameEn': _companyNameEn.text,
          'facilityKind': _facilityKind,
          'phone': _phone.text,
          'email': _email.text,
          'address': _address.text,
          'hqCode': _hqCode.text,
          'hqNameAr': _hqNameAr.text,
          'hqNameEn': _hqNameEn.text,
          'adminUsername': _adminUsername.text,
        }),
      );
    } catch (_) {
      // Nothing here is critical; the form works without the draft.
    }
  }

  Future<void> _clearDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_draftKey);
    } catch (_) {}
  }

  Future<void> _pickLogo() async {
    final picked = await pickFile(
      extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    );
    if (picked == null || !mounted) return;
    try {
      final bytes = await normalizeCompanyLogo(picked.bytes);
      if (!mounted) return;
      setState(() {
        _logo = PickedFile(
          name: 'company-logo.png',
          bytes: bytes,
          mimeType: 'image/png',
        );
        _localError = null;
      });
    } on CompanyLogoImageException catch (problem) {
      if (!mounted) return;
      setState(() {
        _localError = problem.tooLarge
            ? 'الشعار بعد التصغير أكبر من ٢ ميجابايت / The resized logo is larger than 2 MB'
            : 'اختر صورة PNG أو JPEG أو WebP صالحة، وبأبعاد لا تقل عن ٣٢ × ٣٢ بكسل / Choose a valid PNG, JPEG or WebP image at least 32 × 32 pixels';
      });
    }
  }

  void _submit() {
    final code = _companyCode.text.trim();
    final nameAr = _companyNameAr.text.trim();
    final nameEn = _companyNameEn.text.trim();
    final username = _adminUsername.text.trim();
    final password = _adminPassword.text;

    final errors = <String, String>{};
    final codePattern = RegExp(r'^[A-Za-z0-9_-]{2,20}$');
    if (!codePattern.hasMatch(code)) {
      errors['companyCode'] = 'استخدم ٢ إلى ٢٠ حرفًا أو رقمًا أو - أو _ / Use 2-20 letters, digits, dash or underscore';
    }
    if (nameAr.isEmpty) errors['companyNameAr'] = 'الاسم مطلوب / Name is required';
    if (nameEn.isEmpty) errors['companyNameEn'] = 'الاسم مطلوب / Name is required';
    if (username.length < 3 || username.length > 60) {
      errors['adminUsername'] = 'اسم المستخدم من ٣ إلى ٦٠ حرفًا / Username needs 3-60 characters';
    }
    if (password.length < 8 || password.length > 200) {
      errors['adminPassword'] = 'كلمة السر من ٨ إلى ٢٠٠ حرف / Password needs 8-200 characters';
    }
    if (password != _adminAgain.text) {
      errors['adminAgain'] = 'كلمة السر والتأكيد مش زي بعض / The two passwords do not match';
    }
    final email = _email.text.trim();
    if (email.isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      errors['email'] = 'اكتب بريدًا إلكترونيًا صحيحًا / Enter a valid email';
    }
    if (_hqCode.text.trim().isNotEmpty && !codePattern.hasMatch(_hqCode.text.trim())) {
      errors['hqCode'] = 'استخدم ٢ إلى ٢٠ حرفًا أو رقمًا أو - أو _ / Use 2-20 letters, digits, dash or underscore';
    }
    for (final entry in {
      'companyNameAr': (_companyNameAr, 200),
      'companyNameEn': (_companyNameEn, 200),
      'phone': (_phone, 50), 'email': (_email, 200),
      'address': (_address, 500),
      'hqNameAr': (_hqNameAr, 200), 'hqNameEn': (_hqNameEn, 200),
    }.entries) {
      if (entry.value.$1.text.trim().length > entry.value.$2) {
        errors[entry.key] = 'الحد الأقصى ${entry.value.$2} حرف / Maximum ${entry.value.$2} characters';
      }
    }
    setState(() {
      _fieldErrors..clear()..addAll(errors);
      _localError = null;
    });
    if (errors.isNotEmpty) return;

    widget
        .onSubmit(
          CompanySetupData(
            companyCode: code,
            companyNameAr: nameAr,
            companyNameEn: nameEn,
            facilityKind: _facilityKind,
            phone: _phone.text.trim(),
            email: _email.text.trim(),
            address: _address.text.trim(),
            hqCode: _hqCode.text.trim().isEmpty ? null : _hqCode.text.trim(),
            hqNameAr: _hqNameAr.text.trim().isEmpty
                ? null
                : _hqNameAr.text.trim(),
            hqNameEn: _hqNameEn.text.trim().isEmpty
                ? null
                : _hqNameEn.text.trim(),
            logoBytes: _logo?.bytes,
            logoMime: _logo?.mimeType,
            adminUsername: username,
            adminPassword: password,
          ),
        )
        .then((_) => _clearDraft());
  }

  /// Below this width the fields stack in one column; above it they sit side
  /// by side. Three fixed `Expanded` fields in a plain Row were what overflowed
  /// on narrow screens.
  static const double _stackBreakpoint = 560;
  static const double _minFieldWidth = 300;

  Widget _fieldRow(List<Widget> fields) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // Each field needs room for its whole bilingual label; a label that
        // would be clipped is a defect, so stack instead of squeezing.
        final needed = fields.length * _minFieldWidth + (fields.length - 1) * 12;
        if (constraints.maxWidth < _stackBreakpoint || constraints.maxWidth < needed) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < fields.length; i++) ...[
                if (i > 0) const SizedBox(height: 12),
                fields[i],
              ],
            ],
          );
        }
        return Row(
          children: [
            for (var i = 0; i < fields.length; i++) ...[
              if (i > 0) const SizedBox(width: 12),
              Expanded(child: fields[i]),
            ],
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final busy = widget.busy;
    final error = _localError ?? widget.error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'بيانات الشركة / Company',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _companyNameAr,
          onChanged: (_) => _clearField('companyNameAr'),
          enabled: !busy,
          decoration: InputDecoration(
            errorText: _fieldErrors['companyNameAr'],
            labelText: 'اسم الشركة بالعربية * / Name (Arabic) *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _companyNameEn,
          onChanged: (_) => _clearField('companyNameEn'),
          enabled: !busy,
          decoration: InputDecoration(
            errorText: _fieldErrors['companyNameEn'],
            labelText: 'اسم الشركة بالإنجليزية * / Name (English) *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        _fieldRow([
          TextField(
            controller: _companyCode,
          onChanged: (_) => _clearField('companyCode'),
            enabled: !busy,
            decoration: InputDecoration(
            errorText: _fieldErrors['companyCode'],
              labelText: 'كود الشركة * / Code *',
              border: OutlineInputBorder(),
            ),
          ),
          TextField(
            controller: _phone,
          onChanged: (_) => _clearField('phone'),
            enabled: !busy,
            decoration: InputDecoration(
            errorText: _fieldErrors['phone'],
              labelText: 'الهاتف / Phone',
              border: OutlineInputBorder(),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        TextField(
          controller: _email,
          onChanged: (_) => _clearField('email'),
          enabled: !busy,
          decoration: InputDecoration(
            errorText: _fieldErrors['email'],
            labelText: 'البريد الإلكتروني / Email',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _address,
          onChanged: (_) => _clearField('address'),
          enabled: !busy,
          decoration: InputDecoration(
            errorText: _fieldErrors['address'],
            labelText: 'العنوان / Address',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'نوع المنشأة / Facility kind',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(
              value: 'HEADQUARTERS',
              label: Text('مقر رئيسي / Headquarters'),
              icon: Icon(Icons.account_balance),
            ),
            ButtonSegment(
              value: 'BRANCH',
              label: Text('فرع / Branch'),
              icon: Icon(Icons.storefront_outlined),
            ),
          ],
          selected: {_facilityKind},
          onSelectionChanged: busy
              ? null
              : (set) {
                  setState(() {
                    _facilityKind = set.first;
                    if (_hqCode.text.trim().isEmpty ||
                        _hqCode.text == 'MAIN' ||
                        _hqCode.text == 'BR01') {
                      _hqCode.text = _facilityKind == 'HEADQUARTERS'
                          ? 'MAIN'
                          : 'BR01';
                    }
                  });
                },
        ),
        const SizedBox(height: 8),
        Text(
          _facilityKind == 'HEADQUARTERS'
              ? 'الوحدة الأولى هي المقر الرئيسي للشركة. الفروع يمكن إضافتها لاحقًا. / The first unit is the headquarters.'
              : 'هذه المنشأة فرع تابع للشركة. / This facility is a branch of the company.',
          style: const TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 12),
        _fieldRow([
          TextField(
            controller: _hqCode,
          onChanged: (_) => _clearField('hqCode'),
            enabled: !busy,
            decoration: InputDecoration(
            errorText: _fieldErrors['hqCode'],
              labelText: _facilityKind == 'HEADQUARTERS'
                  ? 'كود المقر / Unit code (MAIN)'
                  : 'كود الفرع / Branch code (BR01)',
              border: const OutlineInputBorder(),
            ),
          ),
          TextField(
            controller: _hqNameAr,
          onChanged: (_) => _clearField('hqNameAr'),
            enabled: !busy,
            decoration: InputDecoration(
            errorText: _fieldErrors['hqNameAr'],
              labelText: _facilityKind == 'HEADQUARTERS'
                  ? 'اسم المقر بالعربية / HQ name (Arabic)'
                  : 'اسم الفرع بالعربية / Branch name (Arabic)',
              border: const OutlineInputBorder(),
            ),
          ),
          TextField(
            controller: _hqNameEn,
          onChanged: (_) => _clearField('hqNameEn'),
            enabled: !busy,
            decoration: InputDecoration(
            errorText: _fieldErrors['hqNameEn'],
              labelText: _facilityKind == 'HEADQUARTERS'
                  ? 'اسم المقر بالإنجليزية / HQ name (English)'
                  : 'اسم الفرع بالإنجليزية / Branch name (English)',
              border: const OutlineInputBorder(),
            ),
          ),
        ]),
        const SizedBox(height: 20),
        const Text(
          'شعار الشركة (اختياري) / Company logo (optional)',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        // Wraps instead of overflowing: on a narrow form the picker, the
        // preview and the remove button move onto a second line.
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton.icon(
              onPressed: busy ? null : _pickLogo,
              icon: const Icon(Icons.image_outlined, size: 18),
              label: const Text('اختيار صورة / Choose image'),
            ),
            if (_logo != null) ...[
              Image.memory(
                _logo!.bytes,
                width: 40,
                height: 40,
                fit: BoxFit.contain,
              ),
              IconButton(
                // This form predates the localisation layer and every
                // neighbouring label is bilingual; adding one l10n lookup here
                // would need an import the rest of the file does not have.
                tooltip: 'إزالة / Remove',
                onPressed: busy ? null : () => setState(() => _logo = null),
                icon: const Icon(Icons.close, size: 18),
              ),
            ],
          ],
        ),
        const SizedBox(height: 20),
        const Text(
          'حساب المدير الأول / First administrator',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _adminUsername,
          onChanged: (_) => _clearField('adminUsername'),
          enabled: !busy,
          decoration: InputDecoration(
            errorText: _fieldErrors['adminUsername'],
            labelText: 'اسم المستخدم * / Username *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _adminPassword,
          onChanged: (_) => _clearField('adminPassword'),
          enabled: !busy,
          obscureText: _obscure,
          decoration: InputDecoration(
            errorText: _fieldErrors['adminPassword'],
            labelText: 'كلمة السر * / Password * (8+)',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: Icon(
                _obscure
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined,
              ),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _adminAgain,
          onChanged: (_) => _clearField('adminAgain'),
          enabled: !busy,
          obscureText: _obscure,
          onSubmitted: (_) => busy ? null : _submit(),
          decoration: InputDecoration(
            errorText: _fieldErrors['adminAgain'],
            labelText: 'تأكيد كلمة السر / Confirm',
            border: OutlineInputBorder(),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 12),
          Text(
            error,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: busy ? null : _submit,
          icon: busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check),
          label: Text(widget.submitLabel),
        ),
      ],
    );
  }
}
