import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/backend/company_setup_data.dart';
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
  });

  /// Called with everything collected, after the form's own validation.
  final Future<void> Function(CompanySetupData data) onSubmit;

  final String submitLabel;
  final bool busy;
  final String? error;

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

  @override
  void initState() {
    super.initState();
    _restoreDraft();
    for (final controller in [
      _companyCode, _companyNameAr, _companyNameEn, _phone, _email,
      _address, _hqCode, _hqNameAr, _hqNameEn, _adminUsername,
    ]) {
      controller.addListener(_saveDraft);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _companyCode, _companyNameAr, _companyNameEn, _phone, _email,
      _address, _hqCode, _hqNameAr, _hqNameEn, _adminUsername,
      _adminPassword, _adminAgain,
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
    final picked = await pickFile(extensions: ['.png', '.jpg', '.jpeg', '.webp']);
    if (picked == null || !mounted) return;
    if (picked.sizeInBytes > 2 * 1024 * 1024) {
      setState(() => _localError = 'الشعار أكبر من ٢ ميجابايت / The logo is larger than 2 MB');
      return;
    }
    setState(() {
      _logo = picked;
      _localError = null;
    });
  }

  void _submit() {
    final code = _companyCode.text.trim();
    final nameAr = _companyNameAr.text.trim();
    final nameEn = _companyNameEn.text.trim();
    final username = _adminUsername.text.trim();
    final password = _adminPassword.text;

    String? problem;
    if (code.length < 2) {
      problem = 'كود الشركة لازم حرفين على الأقل / Company code needs at least 2 characters';
    } else if (nameAr.isEmpty || nameEn.isEmpty) {
      problem = 'اسم الشركة بالعربي والإنجليزي مطلوب / Both company names are required';
    } else if (username.length < 3) {
      problem = 'اسم المستخدم لازم ٣ حروف على الأقل / Username needs at least 3 characters';
    } else if (password.length < 8) {
      problem = 'كلمة السر لازم ٨ حروف على الأقل / Password needs at least 8 characters';
    } else if (password != _adminAgain.text) {
      problem = 'كلمة السر والتأكيد مش زي بعض / The two passwords do not match';
    }
    if (problem != null) {
      setState(() => _localError = problem);
      return;
    }
    setState(() => _localError = null);

    widget.onSubmit(
      CompanySetupData(
        companyCode: code,
        companyNameAr: nameAr,
        companyNameEn: nameEn,
        facilityKind: _facilityKind,
        phone: _phone.text.trim(),
        email: _email.text.trim(),
        address: _address.text.trim(),
        hqCode: _hqCode.text.trim().isEmpty ? null : _hqCode.text.trim(),
        hqNameAr: _hqNameAr.text.trim().isEmpty ? null : _hqNameAr.text.trim(),
        hqNameEn: _hqNameEn.text.trim().isEmpty ? null : _hqNameEn.text.trim(),
        logoBytes: _logo?.bytes,
        logoMime: _logo?.mimeType,
        adminUsername: username,
        adminPassword: password,
      ),
    ).then((_) => _clearDraft());
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
          enabled: !busy,
          decoration: const InputDecoration(
            labelText: 'اسم الشركة بالعربية * / Name (Arabic) *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _companyNameEn,
          enabled: !busy,
          decoration: const InputDecoration(
            labelText: 'اسم الشركة بالإنجليزية * / Name (English) *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _companyCode,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: 'كود الشركة * / Code *',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _phone,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: 'الهاتف / Phone',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _email,
          enabled: !busy,
          decoration: const InputDecoration(
            labelText: 'البريد الإلكتروني / Email',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _address,
          enabled: !busy,
          decoration: const InputDecoration(
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
                      _hqCode.text =
                          _facilityKind == 'HEADQUARTERS' ? 'MAIN' : 'BR01';
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
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _hqCode,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: _facilityKind == 'HEADQUARTERS'
                      ? 'كود المقر / Unit code (MAIN)'
                      : 'كود الفرع / Branch code (BR01)',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _hqNameAr,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: _facilityKind == 'HEADQUARTERS'
                      ? 'اسم المقر بالعربية / HQ name (Arabic)'
                      : 'اسم الفرع بالعربية / Branch name (Arabic)',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _hqNameEn,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: _facilityKind == 'HEADQUARTERS'
                      ? 'اسم المقر بالإنجليزية / HQ name (English)'
                      : 'اسم الفرع بالإنجليزية / Branch name (English)',
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            const Text(
              'شعار الشركة (اختياري) / Company logo (optional)',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(width: 16),
            OutlinedButton.icon(
              onPressed: busy ? null : _pickLogo,
              icon: const Icon(Icons.image_outlined, size: 18),
              label: const Text('اختيار صورة / Choose image'),
            ),
            if (_logo != null) ...[
              const SizedBox(width: 8),
              Image.memory(_logo!.bytes, width: 40, height: 40, fit: BoxFit.contain),
              IconButton(
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
          enabled: !busy,
          decoration: const InputDecoration(
            labelText: 'اسم المستخدم * / Username *',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _adminPassword,
          enabled: !busy,
          obscureText: _obscure,
          decoration: InputDecoration(
            labelText: 'كلمة السر * / Password * (8+)',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _adminAgain,
          enabled: !busy,
          obscureText: _obscure,
          onSubmitted: (_) => busy ? null : _submit(),
          decoration: const InputDecoration(
            labelText: 'تأكيد كلمة السر / Confirm',
            border: OutlineInputBorder(),
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 12),
          Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: busy ? null : _submit,
          icon: busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.check),
          label: Text(widget.submitLabel),
        ),
      ],
    );
  }
}
