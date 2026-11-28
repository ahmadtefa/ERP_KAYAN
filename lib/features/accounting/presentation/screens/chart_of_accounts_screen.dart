import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/account_type_labels.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/account_name.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import '../../../operations/ops_auto_create.dart';
import '../../data/datasources/chart_of_accounts_data_source.dart';
import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';
import '../providers/chart_of_accounts_providers.dart';

/// The chart of accounts as a tree: every depth, expandable, searchable, and
/// editable — with every rule still enforced on the server, never here.
String _t(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;
class ChartOfAccountsScreen extends ConsumerStatefulWidget {
  const ChartOfAccountsScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<ChartOfAccountsScreen> createState() => _ChartOfAccountsScreenState();
}

class _ChartOfAccountsScreenState extends ConsumerState<ChartOfAccountsScreen> {
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    opsRunAutoCreate(this, () => _editAccount(context, ref, null, _exitRelay));
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(chartOfAccountsProvider);
    final showSampleNotice = ref.watch(appConfigProvider).useSeedData;
    final l10n = context.l10n;
    final canCreate = ref.watch(currentUserProvider)?.can('accounting.accounts.create') ?? false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          title: l10n.chartOfAccounts,
          subtitle: _t(
            context,
            'كل حساب يظهر تحت أبيه. الحساب ذو الـ8 أرقام فقط يقبل القيود، وما فوقه مجاميع.',
            'Every account sits under its parent. Only an 8-digit account takes entries; the shorter ones are totals.',
          ),
          actions: [
            IconButton(
              tooltip: l10n.refresh,
              onPressed: () => ref.read(chartOfAccountsProvider.notifier).refresh(),
              icon: const Icon(Icons.refresh),
            ),
            const ListExportActions(list: 'chart-of-accounts'),
            if (canCreate) FilledButton.icon(
              onPressed: () => _editAccount(context, ref, null, _exitRelay),
              icon: const Icon(Icons.add, size: 17),
              label: Text(l10n.newAccount),
            ),
          ],
        ),
        if (showSampleNotice) const _SampleDataBanner(),
        Container(
          height: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xxl,
            AppSpacing.md,
            AppSpacing.xxl,
            AppSpacing.sm,
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: InputDecoration(
                    hintText: l10n.searchAccounts,
                    prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  ),
                  onChanged: (value) =>
                      ref.read(accountSearchProvider.notifier).setQuery(value),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              _TypeFilter(ref: ref),
            ],
          ),
        ),
        Expanded(
          child: AsyncStateView<List<Account>>(
            value: accounts,
            onRetry: () => ref.read(chartOfAccountsProvider.notifier).refresh(),
            emptyMessage: _t(
              context,
              'لا توجد حسابات بعد. اضغط «حساب جديد» لبناء أول حساب في الدليل.',
              'No accounts yet. Choose "New account" to build the first one.',
            ),
            isEmpty: (list) => list.isEmpty,
            data: (_) => _AccountTree(exitRelay: _exitRelay),
          ),
        ),
      ],
    );
  }
}

class _TypeFilter extends StatelessWidget {
  const _TypeFilter({required this.ref});

  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final current = ref.watch(accountTypeFilterProvider);
    return DropdownButton<AccountType?>(
      value: current,
      hint: Text(context.l10n.accountType),
      onChanged: (value) =>
          ref.read(accountTypeFilterProvider.notifier).setType(value),
      items: [
        DropdownMenuItem<AccountType?>(
          value: null,
          child: Text(context.l10n.allTypes),
        ),
        for (final type in AccountType.values)
          DropdownMenuItem<AccountType?>(
            value: type,
            child: Text(context.l10n.accountTypeLabel(type)),
          ),
      ],
    );
  }
}

class _AccountTree extends ConsumerStatefulWidget {
  const _AccountTree({required this.exitRelay});
  final DraftExitRelay exitRelay;

  @override
  ConsumerState<_AccountTree> createState() => _AccountTreeState();
}

class _AccountTreeState extends ConsumerState<_AccountTree> {
  final Set<String> _collapsed = {};

  @override
  Widget build(BuildContext context) {
    final nodes = ref.watch(accountTreeProvider);
    if (nodes.isEmpty) {
      return EmptyView(
        message: _t(
          context,
          'لا يوجد حساب مطابق للبحث أو التصفية. امسح البحث أو التصفية لعرض الدليل كاملًا.',
          'No account matches the search or filter. Clear them to see the whole chart.',
        ),
        icon: Icons.search_off,
      );
    }

    // Traverse the original parents-first list. A collapsed node hides every
    // deeper descendant, not just its immediate children. Child existence is
    // determined before filtering so the expander remains available to reopen.
    final visible = <({AccountNode node, bool hasChildren})>[];
    int? hiddenBelowDepth;
    for (var index = 0; index < nodes.length; index++) {
      final node = nodes[index];
      if (hiddenBelowDepth != null && node.depth <= hiddenBelowDepth) {
        hiddenBelowDepth = null;
      }
      if (hiddenBelowDepth != null) continue;
      final hasChildren =
          index + 1 < nodes.length && nodes[index + 1].depth > node.depth;
      visible.add((node: node, hasChildren: hasChildren));
      if (hasChildren && _collapsed.contains(node.account.id)) {
        hiddenBelowDepth = node.depth;
      }
    }

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: visible.length,
      itemBuilder: (context, index) {
        final entry = visible[index];
        final id = entry.node.account.id;
        return _AccountTile(
          key: ValueKey(id),
          node: entry.node,
          exitRelay: widget.exitRelay,
          hasChildren: entry.hasChildren,
          expanded: !_collapsed.contains(id),
          onToggle: () => setState(() {
            if (!_collapsed.remove(id)) _collapsed.add(id);
          }),
        );
      },
    );
  }
}

class _AccountTile extends ConsumerWidget {
  const _AccountTile({
    super.key,
    required this.node,
    required this.exitRelay,
    required this.hasChildren,
    required this.expanded,
    required this.onToggle,
  });

  final AccountNode node;
  final DraftExitRelay exitRelay;
  final bool hasChildren;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = node.account;
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final indent = 8.0 + node.depth * 20.0;
    final user = ref.watch(currentUserProvider);
    final canUpdate = user?.can('accounting.accounts.update') ?? false;
    final canDelete = user?.can('accounting.accounts.delete') ?? false;

    final nameStyle = TextStyle(
      fontWeight: account.isPostable ? FontWeight.w400 : FontWeight.w600,
      color: account.isActive ? null : theme.disabledColor,
    );

    return ListTile(
      dense: true,
      contentPadding: EdgeInsetsDirectional.only(start: indent, end: 8),
      leading: hasChildren
          ? IconButton(
              tooltip: expanded
                  ? (lang == 'ar' ? 'طي الحسابات الفرعية' : 'Collapse subaccounts')
                  : (lang == 'ar' ? 'إظهار الحسابات الفرعية' : 'Expand subaccounts'),
              icon: Icon(expanded ? Icons.expand_more : Icons.chevron_right),
              onPressed: onToggle,
            )
          : const SizedBox(width: 24),
      title: Text(
        '${account.code}  ${accountName(account, lang)}',
        style: nameStyle,
      ),
      subtitle: Text(
        [
          l10n.accountTypeLabel(account.type),
          account.isPostable ? l10n.postable : l10n.grouping,
          if (account.cashFlowClass != null)
            switch (account.cashFlowClass) {
              'OPERATING' => lang == 'ar' ? 'تدفق تشغيلي' : 'Operating',
              'INVESTING' => lang == 'ar' ? 'تدفق استثماري' : 'Investing',
              'FINANCING' => lang == 'ar' ? 'تدفق تمويلي' : 'Financing',
              _ => account.cashFlowClass!,
            },
          if (!account.isActive) l10n.inactiveLabel,
        ].join(' · '),
        style: theme.textTheme.bodySmall,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!account.isActive)
            Icon(Icons.block, size: 18, color: theme.colorScheme.error),
          if (canUpdate) IconButton(
            tooltip: account.isActive ? l10n.deactivateAccount : l10n.activateAccount,
            icon: Icon(
              account.isActive ? Icons.toggle_on_outlined : Icons.toggle_off_outlined,
              size: 22,
            ),
            onPressed: () => _toggleActive(context, ref, account),
          ),
          if (canUpdate) IconButton(
            tooltip: l10n.editAccount,
            icon: const Icon(Icons.edit_outlined, size: 20),
            onPressed: () => _editAccount(context, ref, account, exitRelay),
          ),
          if (canDelete) IconButton(
            tooltip: l10n.deleteAccount,
            icon: const Icon(Icons.delete_outline, size: 20),
            onPressed: () => _deleteAccount(context, ref, account),
          ),
        ],
      ),
    );
  }
}

/// Opens the create/edit form. `null` means a new account.
Future<void> _editAccount(
  BuildContext context,
  WidgetRef ref,
  Account? existing,
  DraftExitRelay exitRelay,
) async {
  final all = ref.read(chartOfAccountsProvider).value ?? const <Account>[];
  // Every account of a company carries the same scheme.
  final eightDigit = all.any((a) => a.isEightDigitScheme);

  // Parents: every account of the same type, except the account being edited
  // and anything under it — the server refuses those anyway, so they are not
  // offered.
  final excluded = <String>{};
  if (existing != null) {
    excluded.add(existing.id);
    bool changed = true;
    while (changed) {
      changed = false;
      for (final a in all) {
        if (a.parentId != null &&
            excluded.contains(a.parentId) &&
            excluded.add(a.id)) {
          changed = true;
        }
      }
    }
  }

  final parents = all
      .where(
        (a) =>
            !excluded.contains(a.id) &&
            // An 8-digit account is the last level of an eight digit chart.
            !(eightDigit && a.code.length >= 8) &&
            (existing == null || a.type == existing.type),
      )
      .toList(growable: false);

  String? selectedParent = existing?.parentId;
  var selectedType = existing?.type ?? AccountType.asset;
  var isPostable = existing?.isPostable ?? true;
  // Eight digit chart: only an 8-digit account takes entries, so the flag is
  // derived from the code and not chosen.
  bool postableForCode(String code) => code.trim().length == 8;
  if (eightDigit) isPostable = postableForCode(existing?.code ?? '');
  var isActive = existing?.isActive ?? true;
  var selectedCashFlow = existing?.cashFlowClass;

  final codeController = TextEditingController(text: existing?.code ?? '');
  final nameArController = TextEditingController(text: existing?.nameAr ?? '');
  final descriptionController = TextEditingController(
    text: existing?.description ?? '',
  );
  final nameEnController = TextEditingController(text: existing?.nameEn ?? '');

  // The suggested code follows the chart's own numbering as soon as a parent
  // is chosen and the field is still untouched.
  if (existing == null) {
    final suggestion = await ref
        .read(chartOfAccountsRepositoryProvider)
        .suggestCode(parentId: selectedParent);
    codeController.text = suggestion.valueOrNull ?? '';
    if (eightDigit) isPostable = postableForCode(codeController.text);
    if (!context.mounted) {
      codeController.dispose();
      nameArController.dispose();
      descriptionController.dispose();
      nameEnController.dispose();
      return;
    }
  }

  final initial = (
    codeController.text, nameArController.text, nameEnController.text,
    descriptionController.text, selectedParent, selectedType, isPostable,
    isActive, selectedCashFlow,
  );
  bool saving = false;
  // The API can commit before its response is lost. Until the server supports
  // idempotency/version checks, keep the draft but do not blindly resubmit it.
  bool uncertain = false;
  // Reasons the server gave per field; a reason clears when its field is edited.
  final fieldErrors = <String, String>{};
  bool confirmingDiscard = false;
  bool hasChanges() => initial != (
    codeController.text, nameArController.text, nameEnController.text,
    descriptionController.text, selectedParent, selectedType, isPostable,
    isActive, selectedCashFlow,
  );

  BuildContext? editorContext;
  Future<bool> canLeave() async {
    final dialogContext = editorContext;
    if (dialogContext == null || !dialogContext.mounted || saving || confirmingDiscard) return false;
    if (hasChanges() || uncertain) {
      final arabic = Localizations.localeOf(dialogContext).languageCode == 'ar';
      confirmingDiscard = true;
      try {
        final discard = await showDialog<bool>(
          context: dialogContext,
          barrierDismissible: false,
          builder: (confirmContext) => AlertDialog(
            title: Text(arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes'),
            content: Text(uncertain
                ? (arabic ? 'قد تكون العملية قد اكتملت. أغلق النموذج وراجع الحسابات قبل المحاولة مجددًا.' : 'The operation may have completed. Close the form and review the accounts before trying again.')
                : (arabic ? 'هل تريد الخروج دون حفظ التغييرات؟' : 'Leave without saving your changes?')),
            actions: [
              TextButton(onPressed: () => Navigator.pop(confirmContext, false),
                  child: Text(arabic ? 'متابعة التعديل' : 'Keep editing')),
              FilledButton(onPressed: () => Navigator.pop(confirmContext, true),
                  child: Text(arabic ? 'الخروج دون حفظ' : 'Discard changes')),
            ],
          ),
        );
        if (discard != true || !dialogContext.mounted) return false;
      } finally { confirmingDiscard = false; }
    }
    return dialogContext.mounted;
  }
  Future<bool> leaveForRoute() async {
    if (!await canLeave()) return false;
    final dialogContext = editorContext;
    if (dialogContext == null || !dialogContext.mounted) return false;
    Navigator.of(dialogContext).pop(false);
    return true;
  }
  Future<void> closeEditor() async { await leaveForRoute(); }

  exitRelay.attach(leaveForRoute);
  try {
  await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setDialogState) {
        editorContext = dialogContext;
        final dialogL10n = dialogContext.l10n;
        final arabic = Localizations.localeOf(dialogContext).languageCode == 'ar';
        return PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) closeEditor();
          },
          child: AlertDialog(
          title: Text(
            existing == null ? dialogL10n.newAccount : dialogL10n.editAccount,
          ),
          content: IgnorePointer(
            ignoring: saving,
            child: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (uncertain) ...[
                    Text(arabic
                        ? 'تعذّر تأكيد نتيجة الحفظ. راجع الحسابات بعد تحديثها قبل المحاولة مجددًا.'
                        : 'The save result is uncertain. Review the refreshed accounts before trying again.'),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    controller: codeController,
                    keyboardType: eightDigit ? TextInputType.number : null,
                    inputFormatters: eightDigit
                        ? [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(8),
                          ]
                        : null,
                    onChanged: (_) {
                      fieldErrors.remove('code');
                      setDialogState(() {
                        if (eightDigit) isPostable = postableForCode(codeController.text);
                      });
                    },
                    decoration: InputDecoration(
                      errorText: fieldErrors['code'],
                      labelText: dialogL10n.accountCode,
                      helperMaxLines: 3,
                      helperText: eightDigit
                          ? (arabic
                              ? 'الكود 2 أو 4 أو 6 أو 8 أرقام، وكل مستوى يضيف رقمين لكود الأب. الحساب ذو الـ8 أرقام فقط يقبل القيود.'
                              : 'Code of 2, 4, 6 or 8 digits; each level adds two digits to its parent code. Only an 8-digit account takes entries.')
                          : dialogL10n.accountCodeHelper,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameArController,
                    onChanged: (_) {
                      if (fieldErrors.remove('nameAr') != null) setDialogState(() {});
                    },
                    decoration: InputDecoration(
                      errorText: fieldErrors['nameAr'],
                      labelText: dialogL10n.nameArabic,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameEnController,
                    onChanged: (_) {
                      if (fieldErrors.remove('nameEn') != null) setDialogState(() {});
                    },
                    decoration: InputDecoration(
                      errorText: fieldErrors['nameEn'],
                      labelText: dialogL10n.nameEnglish,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: descriptionController,
                    maxLength: 500,
                    onChanged: (_) {
                      if (fieldErrors.remove('description') != null) setDialogState(() {});
                    },
                    decoration: InputDecoration(
                      errorText: fieldErrors['description'],
                      labelText: dialogL10n.description,
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<AccountType>(
                    key: ValueKey(selectedType),
                    initialValue: selectedType,
                    decoration: InputDecoration(
                      labelText: dialogL10n.accountType,
                      helperText: selectedParent != null
                          ? 'يطابق نوع الحساب الأب / Matches parent account type'
                          : null,
                    ),
                    items: [
                      for (final type in AccountType.values)
                        DropdownMenuItem(
                          value: type,
                          child: Text(dialogL10n.accountTypeLabel(type)),
                        ),
                    ],
                    onChanged: existing == null && selectedParent == null
                        ? (value) => setDialogState(
                            () => selectedType = value ?? selectedType,
                          )
                        : null,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    initialValue: selectedParent,
                    // The parent catalogue can contain long codes and names.
                    // Constrain its selected display to the dialog width.
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: dialogL10n.parentAccount,
                      helperText: dialogL10n.parentAccountHelper,
                    ),
                    items: [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text(dialogL10n.noParent),
                      ),
                      for (final parent in parents)
                        DropdownMenuItem<String?>(
                          value: parent.id,
                          child: Text(
                            accountLabel(parent, dialogL10n.localeName),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) async {
                      setDialogState(() {
                        selectedParent = value;
                        if (value != null) {
                          for (final p in parents) {
                            if (p.id == value) {
                              selectedType = p.type;
                              break;
                            }
                          }
                        }
                      });
                      if (existing == null &&
                          codeController.text.trim().isEmpty) {
                        final suggestion = await ref
                            .read(chartOfAccountsRepositoryProvider)
                            .suggestCode(parentId: value);
                        if (dialogContext.mounted && selectedParent == value &&
                            codeController.text.trim().isEmpty && suggestion.valueOrNull != null) {
                          setDialogState(
                            () {
                              codeController.text = suggestion.valueOrNull!;
                              if (eightDigit) isPostable = postableForCode(codeController.text);
                            },
                          );
                        }
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  if (isPostable) ...[
                    DropdownButtonFormField<String?>(
                      key: ValueKey(selectedCashFlow),
                      initialValue: selectedCashFlow,
                      decoration: InputDecoration(
                        labelText: Localizations.localeOf(
                                  dialogContext,
                                ).languageCode ==
                                'ar'
                            ? 'تصنيف التدفق النقدي'
                            : 'Cash-flow classification',
                        helperText: Localizations.localeOf(
                                  dialogContext,
                                ).languageCode ==
                                'ar'
                            ? 'يُترك غير مصنّف حتى يحدّده المحاسب — لن يخمّنه النظام'
                            : 'Unclassified until the accountant chooses — never guessed',
                      ),
                      items: [
                        DropdownMenuItem<String?>(
                          value: null,
                          child: Text(
                            Localizations.localeOf(
                                      dialogContext,
                                    ).languageCode ==
                                    'ar'
                                ? 'غير مصنّف'
                                : 'Unclassified',
                          ),
                        ),
                        for (final entry in const [
                          ('OPERATING', 'تشغيلي', 'Operating'),
                          ('INVESTING', 'استثماري', 'Investing'),
                          ('FINANCING', 'تمويلي', 'Financing'),
                        ])
                          DropdownMenuItem<String?>(
                            value: entry.$1,
                            child: Text(
                              Localizations.localeOf(
                                        dialogContext,
                                      ).languageCode ==
                                      'ar'
                                  ? entry.$2
                                  : entry.$3,
                            ),
                          ),
                      ],
                      onChanged: (value) =>
                          setDialogState(() => selectedCashFlow = value),
                    ),
                    const SizedBox(height: 12),
                  ],
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(dialogL10n.postable),
                    subtitle: Text(eightDigit
                        ? (arabic
                            ? 'يتحدد تلقائياً من الكود: الحساب ذو الـ8 أرقام يقبل القيود وغيره تجميعي'
                            : 'Set by the code: an 8-digit account takes entries, shorter codes are totals')
                        : dialogL10n.postableHelper),
                    value: isPostable,
                    onChanged: eightDigit
                        ? null
                        : (value) => setDialogState(() => isPostable = value),
                  ),
                  if (existing != null)
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(dialogL10n.activeAccount),
                      value: isActive,
                      onChanged: (value) =>
                          setDialogState(() => isActive = value),
                    ),
                ],
              ),
            ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : closeEditor,
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: saving || uncertain ? null : () async {
                if (nameArController.text.trim().isEmpty && nameEnController.text.trim().isEmpty) {
                  final reason = arabic
                      ? 'أدخل اسم الحساب بالعربية والإنجليزية.'
                      : 'Enter both the Arabic and English account names.';
                  setDialogState(() {
                    fieldErrors['nameAr'] = reason;
                    fieldErrors['nameEn'] = reason;
                  });
                  showMessage(dialogContext, reason, error: true);
                  return;
                }
                final input = AccountInput(
                  code: codeController.text.trim().isEmpty ? null : codeController.text.trim(),
                  nameAr: nameArController.text.trim(),
                  nameEn: nameEnController.text.trim(),
                  type: selectedType,
                  parentId: selectedParent,
                  updateParent: existing == null || selectedParent != existing.parentId,
                  clearParent: selectedParent == null,
                  checkParent: existing != null && selectedParent != existing.parentId,
                  expectedParentId: existing?.parentId,
                  isPostable: isPostable,
                  isActive: isActive,
                  description: descriptionController.text.trim(),
                  cashFlowClass: isPostable ? selectedCashFlow : null,
                );
                setDialogState(() => saving = true);
                final controller = ref.read(chartOfAccountsProvider.notifier);
                final error = existing == null
                    ? await controller.create(input)
                    : await controller.updateAccount(existing.id, input);
                if (!dialogContext.mounted) return;
                if (error is ApiFailure &&
                    const {400, 422}.contains(error.statusCode) &&
                    error.fieldErrors.isNotEmpty) {
                  // The server refused the content, so nothing was saved and
                  // the form stays editable: reasons go under their fields.
                  const known = {'code', 'nameAr', 'nameEn', 'description'};
                  final rest = <String, String>{};
                  setDialogState(() {
                    saving = false;
                    fieldErrors.clear();
                    for (final entry in error.fieldErrors.entries) {
                      if (known.contains(entry.key)) {
                        fieldErrors[entry.key] = entry.value;
                      } else {
                        rest[entry.key] = entry.value;
                      }
                    }
                  });
                  if (rest.isNotEmpty) {
                    showMessage(
                      dialogContext,
                      ApiFailure(error.message, statusCode: error.statusCode, fieldErrors: rest),
                      error: true,
                    );
                  }
                } else if (error != null) {
                  setDialogState(() {
                    saving = false;
                    uncertain = true;
                  });
                  showMessage(dialogContext, error, error: true);
                } else {
                  Navigator.of(dialogContext).pop(true);
                }
              },
              child: Text(dialogL10n.save),
            ),
          ],
          ),
        );
      },
    ),
  );
  } finally {
    exitRelay.detach(leaveForRoute);
  }
}

/// Activates or deactivates an account in place.
///
/// The request carries the flag and nothing else. It used to send the whole
/// account, including its type, which the update contract does not accept:
/// the API answered `400 property type should not exist` and every
/// deactivation failed. The server still refuses to deactivate a grouping
/// account that has active subaccounts, and says why — that reason is kept.
Future<void> _toggleActive(
  BuildContext context,
  WidgetRef ref,
  Account account,
) async {
  final error = await ref
      .read(chartOfAccountsProvider.notifier)
      .setActive(account.id, isActive: !account.isActive);
  if (context.mounted && error != null) {
    showMessage(context, error, error: true);
  }
}

Future<void> _deleteAccount(
  BuildContext context,
  WidgetRef ref,
  Account account,
) async {
  final l10n = context.l10n;
  final lang = Localizations.localeOf(context).languageCode;

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.deleteAccount),
      content: Text(l10n.deleteAccountConfirm(accountName(account, lang))),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.deleteAccount),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return;

  // The server refuses when the account has movements or children and says
  // why; that message is shown as-is, and the screen offers deactivation as
  // the alternative in the edit form.
  final error = await ref
      .read(chartOfAccountsProvider.notifier)
      .remove(account.id);
  if (context.mounted && error != null) {
    showMessage(context, error, error: true);
  }
}

class _SampleDataBanner extends StatelessWidget {
  const _SampleDataBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final l10n = context.l10n;
    return Material(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.info_outline, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.sampleDataNotice,
                    style: TextStyle(
                      color: scheme.onTertiaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    l10n.sampleDataDetail,
                    style: TextStyle(
                      color: scheme.onTertiaryContainer,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
