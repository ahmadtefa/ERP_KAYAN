import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/image/company_logo_image.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

class CompanyManagementPanel extends ConsumerStatefulWidget {
  const CompanyManagementPanel({super.key});

  @override
  ConsumerState<CompanyManagementPanel> createState() =>
      _CompanyManagementPanelState();
}

class _CompanyManagementPanelState
    extends ConsumerState<CompanyManagementPanel> {
  Map<String, dynamic>? _company;
  PickedFile? _logo;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  bool get _isArabic => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String en, String ar) => _isArabic ? ar : en;
  bool get _canEditCompany {
    final user = ref.read(currentUserProvider);
    return user?.permissions.contains('company.profile.manage') == true;
  }

  String _companyValue(String key) => _company?[key]?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      if (_canEditCompany) _company = await client.get('/companies/profile');
    } catch (e) {
      _error = '$e';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _editCompany() async {
    if (_company == null) return;
    final fields = <String, TextEditingController>{
      'nameEn': TextEditingController(text: _companyValue('nameEn')),
      'nameAr': TextEditingController(text: _companyValue('nameAr')),
      'taxId': TextEditingController(text: _companyValue('taxId')),
      'commercialRegistration': TextEditingController(
        text: _companyValue('commercialRegistration'),
      ),
      'addressEn': TextEditingController(text: _companyValue('addressEn')),
      'addressAr': TextEditingController(text: _companyValue('addressAr')),
      'phone': TextEditingController(text: _companyValue('phone')),
      'email': TextEditingController(text: _companyValue('email')),
    };
    final labels = <String, String>{
      'nameEn': tr('Name (English)', 'الاسم بالإنجليزية'),
      'nameAr': tr('Name (Arabic)', 'الاسم بالعربية'),
      'taxId': tr('Tax ID', 'الرقم الضريبي'),
      'commercialRegistration': tr('Commercial registration', 'السجل التجاري'),
      'addressEn': tr('Address (English)', 'العنوان بالإنجليزية'),
      'addressAr': tr('Address (Arabic)', 'العنوان بالعربية'),
      'phone': tr('Phone', 'الهاتف'),
      'email': tr('Email', 'البريد الإلكتروني'),
    };
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(tr('Company profile', 'بيانات الشركة')),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final entry in fields.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextField(
                      controller: entry.value,
                      decoration: InputDecoration(
                        labelText: labels[entry.key],
                        border: const OutlineInputBorder(),
                      ),
                      maxLines: entry.key.startsWith('address') ? 2 : 1,
                    ),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(tr('Cancel', 'إلغاء')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(tr('Save', 'حفظ')),
          ),
        ],
      ),
    );
    if (save == true && mounted) {
      await _run(() async {
        final body = {
          for (final entry in fields.entries)
            entry.key: entry.value.text.trim(),
        };
        _company = await ref
            .read(apiClientProvider)
            .patch('/companies/profile', body: body);
        ref.invalidate(companyBrandingProvider);
      });
    }
    for (final controller in fields.values) {
      controller.dispose();
    }
  }

  Future<void> _chooseLogo() async {
    try {
      final file = await pickFile(
        extensions: const ['.png', '.jpg', '.jpeg', '.webp'],
      );
      if (file == null) return;
      final bytes = await normalizeCompanyLogo(file.bytes);
      if (!mounted) return;
      setState(() {
        _logo = PickedFile(
          name: 'company-logo.png',
          bytes: bytes,
          mimeType: 'image/png',
        );
        _error = null;
      });
    } on CompanyLogoImageException catch (problem) {
      if (!mounted) return;
      setState(() {
        _error = problem.tooLarge
            ? tr(
                'The resized logo is still larger than 2 MB. Choose a simpler image.',
                'ما زال حجم الشعار بعد التصغير أكبر من ٢ ميجابايت. اختر صورة أبسط.',
              )
            : tr(
                'Choose a valid PNG, JPEG or WebP image at least 32 × 32 pixels.',
                'اختر صورة PNG أو JPEG أو WebP صالحة، وبأبعاد لا تقل عن ٣٢ × ٣٢ بكسل.',
              );
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _saveLogo() async {
    final file = _logo;
    if (file == null) return;
    await _run(() async {
      final client = ref.read(apiClientProvider);
      await client.raw.post<dynamic>(
        '/companies/logo',
        data: FormData.fromMap({
          'file': MultipartFile.fromBytes(file.bytes, filename: file.name),
        }),
        options: Options(contentType: 'multipart/form-data'),
      );
      _logo = null;
      _company = await client.get('/companies/profile');
      ref.invalidate(companyBrandingProvider);
    });
  }

  Future<void> _deleteLogo() async {
    await _run(() async {
      await ref.read(apiClientProvider).delete('/companies/logo');
      _logo = null;
      _company = await ref.read(apiClientProvider).get('/companies/profile');
      ref.invalidate(companyBrandingProvider);
    });
  }

  String _friendlyError(Object error) {
    final response = error is DioException ? error.response?.data : null;
    final raw = response is Map && response['detail'] is String
        ? response['detail'] as String
        : '$error';
    final lower = raw.toLowerCase();
    if (lower.contains('larger than') || lower.contains('too large')) {
      return tr(
        'The resized logo is still larger than 2 MB. Choose a simpler image.',
        'ما زال حجم الشعار بعد التصغير أكبر من ٢ ميجابايت. اختر صورة أبسط.',
      );
    }
    if (lower.contains('logo') || lower.contains('image') ||
        lower.contains('png') || lower.contains('jpeg') || lower.contains('webp')) {
      return tr(
        'Choose a valid PNG, JPEG or WebP image at least 32 × 32 pixels.',
        'اختر صورة PNG أو JPEG أو WebP صالحة، وبأبعاد لا تقل عن ٣٢ × ٣٢ بكسل.',
      );
    }
    return raw;
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      _error = _friendlyError(e);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    if (!_canEditCompany) return const SizedBox.shrink();
    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: CircularProgressIndicator(),
        ),
      );
    }
    final base = ref.watch(appConfigProvider).apiBaseUrl;
    final user = ref.watch(currentUserProvider);
    // Use the same API-prefix-aware, versioned URL as every other company mark.
    final savedLogoUrl = companyLogoUrl(base, {
      ...?_company,
      if (_company?['id'] == null && user != null) 'id': user.companyId,
      'hasLogo': _company?['hasLogo'] == true || _company?['logoUrl'] != null,
    });
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        tr('Company profile and logo', 'بيانات الشركة والشعار'),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      onPressed: _busy ? null : _editCompany,
                      icon: const Icon(Icons.edit_outlined),
                      tooltip: tr(
                        'Edit company profile',
                        'تعديل بيانات الشركة',
                      ),
                    ),
                  ],
                ),
                Text(
                  '${_company?['nameEn'] ?? ''}  |  ${_company?['nameAr'] ?? ''}',
                ),
                if ((_company?['phone'] ?? '').toString().isNotEmpty)
                  Text('${tr('Phone', 'الهاتف')}: ${_company?['phone']}'),
                const SizedBox(height: 12),
                Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        width: 76,
                        height: 76,
                        child: _logo != null
                            ? Image.memory(_logo!.bytes, fit: BoxFit.contain)
                            : (savedLogoUrl == null
                                  ? const Icon(Icons.business, size: 48)
                                  : Image.network(
                                      savedLogoUrl,
                                      key: ValueKey(savedLogoUrl),
                                      fit: BoxFit.contain,
                                      errorBuilder: (_, _, _) =>
                                          const Icon(Icons.business, size: 48),
                                    )),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _chooseLogo,
                            icon: const Icon(Icons.image_outlined),
                            label: Text(
                              _logo == null
                                  ? tr('Choose logo', 'اختيار الشعار')
                                  : tr('Choose another', 'اختيار صورة أخرى'),
                            ),
                          ),
                          if (_logo != null)
                            FilledButton(
                              onPressed: _busy ? null : _saveLogo,
                              child: Text(tr('Upload logo', 'رفع الشعار')),
                            ),
                          if ((_company?['logoUrl'] as String?) != null)
                            TextButton.icon(
                              onPressed: _busy ? null : _deleteLogo,
                              icon: const Icon(Icons.delete_outline),
                              label: Text(tr('Remove', 'حذف')),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        if (_busy) const LinearProgressIndicator(),
      ],
    );
  }
}
