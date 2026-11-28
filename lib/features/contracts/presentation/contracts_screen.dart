import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/field_option.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Contracts and progress claims (المستخلصات): the customer's contract, the
/// work claimed so far, the advance recovered and the retention held back.
final contractsProvider = AsyncNotifierProvider<ContractsController, List<Json>>(ContractsController.new);

class ContractsController extends JsonListController {
  @override
  String get resourcePath => '/contracts';
}

class ContractsScreen extends ConsumerStatefulWidget {
  const ContractsScreen({super.key});

  @override
  ConsumerState<ContractsScreen> createState() => _ContractsScreenState();
}

class _ContractsScreenState extends ConsumerState<ContractsScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _today() {
    final d = DateTime.now();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  String _statusLabel(String s) => switch (s) {
        'OPEN' => _arabic ? 'ساري' : 'Open',
        'CLOSED' => _arabic ? 'مغلق' : 'Closed',
        'DRAFT' => _arabic ? 'بانتظار الاعتماد' : 'Waiting for approval',
        'INVOICED' => _arabic ? 'معتمد وصدرت فاتورته' : 'Approved and invoiced',
        'CANCELLED' => _arabic ? 'ملغي' : 'Cancelled',
        _ => s,
      };

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canManage = user?.can('contracts.manage') ?? false;
    final async = ref.watch(contractsProvider);
    return ModuleScaffold(
      title: _arabic ? 'العقود والمستخلصات' : 'Contracts and progress claims',
      eyebrow: _arabic ? 'المبيعات' : 'Sales',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canManage)
            FilledButton.icon(
              key: const ValueKey('contract-new'),
              onPressed: _newContract,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'عقد جديد' : 'New contract'),
            ),
          IconButton(tooltip: _arabic ? 'تحديث' : 'Refresh', icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(contractsProvider)),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(contractsProvider.notifier).reload(),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: _arabic ? 'لا توجد عقود بعد. أضف عقدًا ثم جهّز مستخلصاته.' : 'No contracts yet. Add a contract, then prepare its claims.',
        data: (rows) => RecordsTable(
          rows: rows,
          onTap: _open,
          columns: [
            ColumnSpec(_arabic ? 'الرمز' : 'Code', value: (r) => text(r, 'code'), emphasise: true),
            ColumnSpec(_arabic ? 'العقد' : 'Contract', value: (r) => text(r, 'titleAr')),
            ColumnSpec(_arabic ? 'قيمة العقد بعد التعديل' : 'Value after changes', value: (r) => text(r, 'effectiveValue')),
            ColumnSpec(_arabic ? 'الأعمال المفوترة' : 'Work billed', value: (r) => text(r, 'billedWork')),
            ColumnSpec(_arabic ? 'المحتجز لدى العميل' : 'Retention held', value: (r) => text(r, 'retentionHeld')),
            ColumnSpec(
              _arabic ? 'الحالة' : 'Status',
              value: (r) => _statusLabel(text(r, 'status')),
              tone: (r) => text(r, 'status') == 'OPEN' ? AppTone.success : AppTone.neutral,
            ),
          ],
          actions: (row) => [
            IconButton(
              key: ValueKey('contract-open-${text(row, 'code')}'),
              tooltip: _arabic ? 'فتح العقد ومستخلصاته' : 'Open the contract and its claims',
              icon: const Icon(Icons.open_in_new, size: 20),
              onPressed: () => _open(row),
            ),
          ],
        ),
      ),
    );
  }

  Future<List<FieldOption>> _customerOptions() async {
    final rows = await ref.read(apiClientProvider).getList('/parties/customers', query: {'pageSize': 200, 'page': 1});
    return [
      for (final c in rows)
        if (c['isActive'] != false)
          FieldOption(text(c, 'id'), _arabic ? text(c, 'nameAr', fallback: text(c, 'nameEn')) : text(c, 'nameEn', fallback: text(c, 'nameAr'))),
    ];
  }

  Future<List<FieldOption>> _serviceItemOptions() async {
    final rows = await ref.read(apiClientProvider).getList('/inventory/items', query: {'pageSize': 200, 'page': 1});
    return [
      for (final i in rows)
        if (i['isActive'] != false && i['isStockTracked'] == false)
          FieldOption(text(i, 'id'), '${text(i, 'code')} - ${_arabic ? text(i, 'nameAr', fallback: text(i, 'nameEn')) : text(i, 'nameEn', fallback: text(i, 'nameAr'))}'),
    ];
  }

  Future<List<FieldOption>> _costCenterOptions() async {
    final rows = await ref.read(apiClientProvider).getList('/accounting/cost-centers');
    return [
      for (final c in rows)
        FieldOption(text(c, 'id'), _arabic ? text(c, 'nameAr', fallback: text(c, 'nameEn')) : text(c, 'nameEn', fallback: text(c, 'nameAr'))),
    ];
  }

  Future<void> _newContract() async {
    List<FieldOption> customers, items, centers;
    try {
      customers = await _customerOptions();
      items = await _serviceItemOptions();
      centers = await _costCenterOptions();
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    if (items.isEmpty) {
      showMessage(
        context,
        _arabic ? 'لا يوجد بند خدمة للفوترة. أنشئ بند خدمة من شاشة الأصناف (بدون تتبع مخزون) ثم أعد المحاولة.' : 'There is no service item to bill with. Create a service item in the items screen (without stock tracking), then try again.',
        error: true,
      );
      return;
    }
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'عقد جديد' : 'New contract',
      submitLabel: _arabic ? 'حفظ العقد' : 'Save the contract',
      initial: {'startDate': _today(), 'retentionPercent': '0', 'advanceAmount': '0'},
      fields: [
        FieldSpec('code', _arabic ? 'رمز العقد' : 'Contract code', required: true, maxLength: 32),
        FieldSpec('titleAr', _arabic ? 'عنوان العقد' : 'Contract title', required: true, maxLength: 200),
        FieldSpec('customerId', _arabic ? 'العميل' : 'Customer', kind: FieldKind.select, required: true, options: customers),
        FieldSpec('serviceItemId', _arabic ? 'بند الفوترة (بند خدمة)' : 'Billing item (a service item)', kind: FieldKind.select, required: true, options: items),
        FieldSpec('costCenterId', _arabic ? 'مركز التكلفة (اختياري)' : 'Cost centre (optional)', kind: FieldKind.select, options: centers),
        FieldSpec('contractValue', _arabic ? 'قيمة العقد' : 'Contract value', kind: FieldKind.decimal, required: true),
        FieldSpec('advanceAmount', _arabic ? 'الدفعة المقدمة' : 'Advance payment', kind: FieldKind.decimal,
            helper: _arabic ? 'تُخصم من المستخلصات بنسبة الأعمال المنفذة. سجّل استلامها بسند قبض ثم اربطه بفاتورة المستخلص.' : 'It is deducted from the claims in proportion to the work done. Record its receipt with a receipt voucher, then link it to the claim invoice.'),
        FieldSpec('retentionPercent', _arabic ? 'نسبة المحتجز %' : 'Retention %', kind: FieldKind.decimal),
        FieldSpec('taxRatePercent', _arabic ? 'نسبة ضريبة القيمة المضافة % (اختياري)' : 'VAT % (optional)', kind: FieldKind.decimal),
        FieldSpec('startDate', _arabic ? 'تاريخ البدء' : 'Start date', kind: FieldKind.date),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/contracts', body: {
          'code': text(values, 'code').trim(),
          'titleAr': text(values, 'titleAr').trim(),
          'customerId': text(values, 'customerId'),
          'serviceItemId': text(values, 'serviceItemId'),
          if (text(values, 'costCenterId').isNotEmpty) 'costCenterId': text(values, 'costCenterId'),
          'contractValue': text(values, 'contractValue').trim(),
          'advanceAmount': text(values, 'advanceAmount').trim().isEmpty ? '0' : text(values, 'advanceAmount').trim(),
          'retentionPercent': text(values, 'retentionPercent').trim().isEmpty ? '0' : text(values, 'retentionPercent').trim(),
          if (text(values, 'taxRatePercent').trim().isNotEmpty) 'taxRatePercent': text(values, 'taxRatePercent').trim(),
          if (text(values, 'startDate').isNotEmpty) 'startDate': text(values, 'startDate'),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم حفظ العقد.' : 'The contract was saved.');
      ref.invalidate(contractsProvider);
    }
  }

  Future<void> _open(Json row) async {
    Json contract;
    try {
      contract = await ref.read(apiClientProvider).getObject('/contracts/${text(row, 'id')}');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final user = ref.read(currentUserProvider);
    final canManage = user?.can('contracts.manage') ?? false;
    final canClaim = user?.can('contracts.claim.create') ?? false;
    final canApprove = user?.can('contracts.claim.approve') ?? false;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) {
          Future<void> act(Future<Json> Function() call, String done) async {
            try {
              final next = await call();
              setState(() => contract = next);
              if (mounted) showMessage(this.context, done);
            } catch (error) {
              if (mounted) showMessage(this.context, error, error: true);
            }
            ref.invalidate(contractsProvider);
          }

          final api = ref.read(apiClientProvider);
          final id = text(contract, 'id');
          final open = text(contract, 'status') == 'OPEN';
          final claims = (contract['claims'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
          Widget line(String label, String value) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [Expanded(child: Text(label)), Text(value, style: const TextStyle(fontWeight: FontWeight.w600))]),
              );
          return AlertDialog(
            title: Text('${text(contract, 'code')} - ${text(contract, 'titleAr')}'),
            content: SizedBox(
              width: 560,
              height: 520,
              child: ListView(
                children: [
                  line(_arabic ? 'قيمة العقد الأصلية' : 'Original value', text(contract, 'contractValue')),
                  line(_arabic ? 'أوامر التغيير' : 'Variations', text(contract, 'variations')),
                  line(_arabic ? 'القيمة بعد التعديل' : 'Value after changes', text(contract, 'effectiveValue')),
                  line(_arabic ? 'الأعمال المفوترة' : 'Work billed', text(contract, 'billedWork')),
                  line(_arabic ? 'المتبقي من الأعمال' : 'Work remaining', text(contract, 'remainingWork')),
                  line(_arabic ? 'الدفعة المقدمة / المخصوم منها' : 'Advance / recovered', '${text(contract, 'advanceAmount')} / ${text(contract, 'advanceRecovered')}'),
                  line(_arabic ? 'المحتجز لدى العميل حاليًا' : 'Retention held now', text(contract, 'retentionHeld')),
                  const Divider(),
                  Text(_arabic ? 'المستخلصات' : 'Claims', style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (claims.isEmpty) Padding(padding: const EdgeInsets.all(8), child: Text(_arabic ? 'لم يُجهّز مستخلص بعد.' : 'No claim has been prepared yet.')),
                  for (final c in claims)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${_arabic ? 'مستخلص رقم' : 'Claim no.'} ${text(c, 'claimNo')} - ${text(c, 'claimDate')} - ${_statusLabel(text(c, 'status'))}', style: const TextStyle(fontWeight: FontWeight.w600)),
                            line(_arabic ? 'إجمالي الأعمال حتى تاريخه' : 'Total work to date', text(c, 'cumulativeWork')),
                            line(_arabic ? 'أعمال هذا المستخلص' : 'Work in this claim', text(c, 'periodWork')),
                            line(_arabic ? 'خصم الدفعة المقدمة' : 'Advance deducted', text(c, 'advanceRecovery')),
                            line(_arabic ? 'المحتجز' : 'Retention', text(c, 'retention')),
                            if (text(c, 'status') == 'DRAFT')
                              Wrap(spacing: 8, children: [
                                if (canApprove)
                                  FilledButton(
                                    key: ValueKey('claim-approve-${text(c, 'claimNo')}'),
                                    onPressed: () => act(() => api.post('/contracts/claims/${text(c, 'id')}/approve'), _arabic ? 'تم اعتماد المستخلص وإنشاء فاتورة مبيعات مسودة له.' : 'The claim was approved and a draft sales invoice was created.'),
                                    child: Text(_arabic ? 'اعتماد وإنشاء الفاتورة' : 'Approve and create the invoice'),
                                  ),
                                if (canClaim)
                                  TextButton(
                                    key: ValueKey('claim-cancel-${text(c, 'claimNo')}'),
                                    onPressed: () => act(() => api.post('/contracts/claims/${text(c, 'id')}/cancel'), _arabic ? 'أُلغي المستخلص.' : 'The claim was cancelled.'),
                                    child: Text(_arabic ? 'إلغاء المستخلص' : 'Cancel the claim'),
                                  ),
                              ]),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              if (open && canClaim)
                TextButton(
                  key: const ValueKey('claim-new'),
                  onPressed: () async {
                    final saved = await showFormSheet(
                      context,
                      title: _arabic ? 'مستخلص جديد' : 'New claim',
                      submitLabel: _arabic ? 'حفظ المستخلص' : 'Save the claim',
                      initial: {'claimDate': _today()},
                      fields: [
                        FieldSpec('claimDate', _arabic ? 'تاريخ المستخلص' : 'Claim date', kind: FieldKind.date, required: true),
                        FieldSpec('cumulativeWork', _arabic ? 'إجمالي الأعمال المنفذة منذ بداية العقد' : 'Total work done since the start', kind: FieldKind.decimal, required: true,
                            helper: _arabic ? 'يحسب البرنامج أعمال الفترة وخصم الدفعة المقدمة والمحتجز تلقائيًا.' : 'The program works out this period, the advance deduction and the retention.'),
                        FieldSpec('note', _arabic ? 'ملاحظة' : 'Note', maxLength: 200),
                      ],
                      onSubmit: (values) async {
                        contract = await api.post('/contracts/$id/claims', body: {
                          'claimDate': text(values, 'claimDate'),
                          'cumulativeWork': text(values, 'cumulativeWork').trim(),
                          if (text(values, 'note').trim().isNotEmpty) 'note': text(values, 'note').trim(),
                        });
                      },
                    );
                    if (saved != null) {
                      setState(() {});
                      ref.invalidate(contractsProvider);
                    }
                  },
                  child: Text(_arabic ? 'مستخلص جديد' : 'New claim'),
                ),
              if (open && canManage)
                TextButton(
                  key: const ValueKey('contract-variation'),
                  onPressed: () async {
                    final saved = await showFormSheet(
                      context,
                      title: _arabic ? 'أمر تغيير' : 'Variation',
                      submitLabel: _arabic ? 'حفظ' : 'Save',
                      initial: {'variationDate': _today()},
                      fields: [
                        FieldSpec('variationDate', _arabic ? 'التاريخ' : 'Date', kind: FieldKind.date, required: true),
                        FieldSpec('amount', _arabic ? 'مبلغ التغيير (سالب للتخفيض)' : 'Change amount (negative to reduce)', kind: FieldKind.decimal, required: true),
                        FieldSpec('note', _arabic ? 'البيان' : 'Description', required: true, maxLength: 200),
                      ],
                      onSubmit: (values) async {
                        contract = await api.post('/contracts/$id/variations', body: {
                          'variationDate': text(values, 'variationDate'),
                          'amount': text(values, 'amount').trim(),
                          'note': text(values, 'note').trim(),
                        });
                      },
                    );
                    if (saved != null) {
                      setState(() {});
                      ref.invalidate(contractsProvider);
                    }
                  },
                  child: Text(_arabic ? 'أمر تغيير' : 'Variation'),
                ),
              if (canManage)
                TextButton(
                  key: const ValueKey('contract-release'),
                  onPressed: () async {
                    final saved = await showFormSheet(
                      context,
                      title: _arabic ? 'صرف المحتجز' : 'Release retention',
                      submitLabel: _arabic ? 'حفظ' : 'Save',
                      initial: {'releaseDate': _today()},
                      fields: [
                        FieldSpec('releaseDate', _arabic ? 'التاريخ' : 'Date', kind: FieldKind.date, required: true),
                        FieldSpec('amount', _arabic ? 'المبلغ المفرج عنه' : 'Amount released', kind: FieldKind.decimal, required: true,
                            helper: _arabic ? 'هذا تسجيل لما أفرج عنه العميل. التحصيل نفسه يُسجَّل بسند قبض على فاتورة المستخلص.' : 'This records what the customer released. The collection itself is recorded with a receipt voucher on the claim invoice.'),
                        FieldSpec('note', _arabic ? 'ملاحظة' : 'Note', maxLength: 200),
                      ],
                      onSubmit: (values) async {
                        contract = await api.post('/contracts/$id/retention-releases', body: {
                          'releaseDate': text(values, 'releaseDate'),
                          'amount': text(values, 'amount').trim(),
                          if (text(values, 'note').trim().isNotEmpty) 'note': text(values, 'note').trim(),
                        });
                      },
                    );
                    if (saved != null) {
                      setState(() {});
                      ref.invalidate(contractsProvider);
                    }
                  },
                  child: Text(_arabic ? 'صرف المحتجز' : 'Release retention'),
                ),
              if (canManage)
                TextButton(
                  key: const ValueKey('contract-status'),
                  onPressed: () => act(() => api.post('/contracts/$id/status', body: {'status': open ? 'CLOSED' : 'OPEN'}), open ? (_arabic ? 'أُغلق العقد.' : 'The contract was closed.') : (_arabic ? 'أُعيد فتح العقد.' : 'The contract was reopened.')),
                  child: Text(open ? (_arabic ? 'إغلاق العقد' : 'Close the contract') : (_arabic ? 'إعادة فتح العقد' : 'Reopen the contract')),
                ),
              TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(_arabic ? 'إغلاق' : 'Close')),
            ],
          );
        },
      ),
    );
  }
}
