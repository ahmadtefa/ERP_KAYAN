import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/confirm_dialog.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Cheques received from customers and issued to suppliers.
///
/// The books move only when the bank confirms: "collected" on a received
/// cheque posts a receipt on the bank account, and "cleared" on an issued
/// cheque posts a payment. Every other step only records where the cheque is.
final chequesProvider = AsyncNotifierProvider<ChequesController, List<Json>>(ChequesController.new);

class ChequesController extends JsonListController {
  @override
  String get resourcePath => '/cheques';
}

/// What a cheque in [status] may do next. Mirrors the server's life cycle,
/// which is what actually decides.
List<String> chequeNextActions(String direction, String status) {
  final received = direction == 'RECEIVED';
  return switch (status) {
    'HELD' => received ? ['deposit', 'bounce', 'cancel'] : ['collect', 'bounce', 'cancel'],
    'DEPOSITED' => ['collect', 'bounce'],
    'BOUNCED' => ['represent', 'cancel'],
    _ => const [],
  };
}

class ChequesScreen extends ConsumerStatefulWidget {
  const ChequesScreen({super.key});

  @override
  ConsumerState<ChequesScreen> createState() => _ChequesScreenState();
}

class _ChequesScreenState extends ConsumerState<ChequesScreen> {
  String _direction = 'ALL';
  String _status = 'OPEN';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _statusLabel(String s) => switch (s) {
    'HELD' => _arabic ? 'في الحافظة' : 'Held',
    'DEPOSITED' => _arabic ? 'مودع بالبنك' : 'Deposited',
    'COLLECTED' => _arabic ? 'تم التحصيل' : 'Collected',
    'BOUNCED' => _arabic ? 'مرتد' : 'Bounced',
    'CANCELLED' => _arabic ? 'ملغي' : 'Cancelled',
    _ => s,
  };

  AppTone _tone(String s) => switch (s) {
    'COLLECTED' => AppTone.success,
    'BOUNCED' => AppTone.danger,
    'DEPOSITED' => AppTone.warning,
    _ => AppTone.neutral,
  };

  String _party(Json r) {
    final name = _arabic
        ? text(r, 'partyAr', fallback: text(r, 'partyEn'))
        : text(r, 'partyEn', fallback: text(r, 'partyAr'));
    return name.isNotEmpty ? name : text(r, 'partyName');
  }

  List<Json> _visible(List<Json> rows) => [
    for (final r in rows)
      if ((_direction == 'ALL' || text(r, 'direction') == _direction) &&
          (_status == 'ALL' ||
              (_status == 'OPEN'
                  ? const {'HELD', 'DEPOSITED'}.contains(text(r, 'status'))
                  : text(r, 'status') == _status)))
        r,
  ];

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(chequesProvider);
    final user = ref.watch(currentUserProvider);
    final canCreate = user?.can('cheques.create') ?? false;
    final canManage = user?.can('cheques.manage') ?? false;
    return ModuleScaffold(
      title: _arabic ? 'الشيكات' : 'Cheques',
      eyebrow: _arabic ? 'الخزينة والبنوك' : 'Cash and banks',
      trailing: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        children: [
          if (canCreate)
            FilledButton.icon(
              onPressed: _create,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'شيك جديد' : 'New cheque'),
            ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: async.isLoading ? null : () => ref.read(chequesProvider.notifier).reload(),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final d in const ['ALL', 'RECEIVED', 'ISSUED'])
                  ChoiceChip(
                    key: ValueKey('cheque-direction-$d'),
                    label: Text(switch (d) {
                      'RECEIVED' => _arabic ? 'واردة من عملاء' : 'Received',
                      'ISSUED' => _arabic ? 'صادرة لموردين' : 'Issued',
                      _ => _arabic ? 'الكل' : 'All',
                    }),
                    selected: _direction == d,
                    onSelected: (_) => setState(() => _direction = d),
                  ),
                const SizedBox(width: 16),
                for (final s in const ['OPEN', 'COLLECTED', 'BOUNCED', 'CANCELLED', 'ALL'])
                  ChoiceChip(
                    key: ValueKey('cheque-status-$s'),
                    label: Text(switch (s) {
                      'OPEN' => _arabic ? 'مفتوحة' : 'Open',
                      'ALL' => _arabic ? 'كل الحالات' : 'Any status',
                      _ => _statusLabel(s),
                    }),
                    selected: _status == s,
                    onSelected: (_) => setState(() => _status = s),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncStateView<List<Json>>(
              value: async,
              onRetry: () => ref.read(chequesProvider.notifier).reload(),
              isEmpty: (rows) => _visible(rows).isEmpty,
              emptyMessage: _arabic
                  ? (canCreate ? 'لا توجد شيكات هنا. اضغط «شيك جديد» لتسجيل واحد.' : 'لا توجد شيكات هنا.')
                  : (canCreate ? 'No cheques here. Use "New cheque" to register one.' : 'No cheques here.'),
              data: (rows) => RecordsTable(
                rows: _visible(rows),
                columns: [
                  ColumnSpec(
                    _arabic ? 'النوع' : 'Type',
                    value: (r) => text(r, 'direction') == 'RECEIVED'
                        ? (_arabic ? 'وارد' : 'Received')
                        : (_arabic ? 'صادر' : 'Issued'),
                  ),
                  ColumnSpec(_arabic ? 'رقم الشيك' : 'Cheque no.', value: (r) => text(r, 'chequeNumber'), emphasise: true),
                  ColumnSpec(_arabic ? 'البنك' : 'Bank', value: (r) => text(r, 'bankName')),
                  ColumnSpec(_arabic ? 'الطرف' : 'Party', value: _party),
                  ColumnSpec(_arabic ? 'الاستحقاق' : 'Due', value: (r) => text(r, 'dueDate')),
                  ColumnSpec(
                    _arabic ? 'المبلغ' : 'Amount',
                    numeric: true,
                    value: (r) => formatAmount(asString(r['amount'])),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    _arabic ? 'الحالة' : 'Status',
                    value: (r) => r['overdue'] == true
                        ? '${_statusLabel(text(r, 'status'))} - ${_arabic ? 'متأخر' : 'overdue'}'
                        : _statusLabel(text(r, 'status')),
                    tone: (r) => r['overdue'] == true ? AppTone.danger : _tone(text(r, 'status')),
                  ),
                ],
                actions: (row) => canManage ? _actions(row) : const [],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _actions(Json row) {
    final next = chequeNextActions(text(row, 'direction'), text(row, 'status'));
    final received = text(row, 'direction') == 'RECEIVED';
    IconData icon(String a) => switch (a) {
      'deposit' => Icons.account_balance_outlined,
      'collect' => Icons.check_circle_outline,
      'bounce' => Icons.undo_outlined,
      'represent' => Icons.replay_outlined,
      _ => Icons.cancel_outlined,
    };
    String label(String a) => switch (a) {
      'deposit' => _arabic ? 'إيداع بالبنك' : 'Deposit at the bank',
      'collect' => received ? (_arabic ? 'تم التحصيل' : 'Mark collected') : (_arabic ? 'تم الصرف من البنك' : 'Mark cleared'),
      'bounce' => _arabic ? 'مرتد' : 'Mark bounced',
      'represent' => _arabic ? 'إعادة تقديم' : 'Present again',
      _ => _arabic ? 'إلغاء' : 'Cancel cheque',
    };
    return [
      for (final a in next)
        IconButton(
          key: ValueKey('cheque-$a-${text(row, 'id')}'),
          tooltip: label(a),
          icon: Icon(icon(a)),
          onPressed: () => _act(row, a, label(a)),
        ),
    ];
  }

  Future<void> _act(Json row, String action, String label) async {
    String? note;
    String? accountId;
    if (action == 'collect' && text(row, 'cashAccountId').isEmpty) {
      List<Json> banks;
      try {
        banks = await ref.read(apiClientProvider).getList('/cash/accounts');
      } catch (error) {
        if (mounted) showMessage(context, error, error: true);
        return;
      }
      if (!mounted) return;
      final values = await showFormSheet(
        context,
        title: label,
        submitLabel: _arabic ? 'تأكيد' : 'Confirm',
        fields: [
          FieldSpec(
            'cashAccountId',
            _arabic ? 'حساب البنك' : 'Bank account',
            kind: FieldKind.select,
            required: true,
            options: [
              for (final b in banks)
                if (b['isActive'] != false && text(b, 'kind').toUpperCase() == 'BANK')
                  FieldOption(text(b, 'id'), '${text(b, 'code')} - ${_arabic ? text(b, 'nameAr', fallback: text(b, 'nameEn')) : text(b, 'nameEn', fallback: text(b, 'nameAr'))}'),
            ],
          ),
        ],
        onSubmit: (values) async {},
      );
      if (values == null || !mounted) return;
      accountId = text(values, 'cashAccountId');
    }
    if (action == 'bounce' || action == 'cancel') {
      final values = await showFormSheet(
        context,
        title: label,
        submitLabel: _arabic ? 'تأكيد' : 'Confirm',
        fields: [
          FieldSpec(
            'note',
            _arabic ? 'السبب' : 'Reason',
            required: true,
            maxLength: 500,
            kind: FieldKind.multiline,
            maxLines: 2,
          ),
        ],
        onSubmit: (values) async {},
      );
      if (values == null || !mounted) return;
      note = text(values, 'note').trim();
    } else if (action == 'collect') {
      final book = text(row, 'direction') == 'RECEIVED'
          ? (_arabic ? 'سيُسجَّل سند قبض على حساب البنك.' : 'A receipt will be posted on the bank account.')
          : (_arabic ? 'سيُسجَّل سند صرف من حساب البنك.' : 'A payment will be posted from the bank account.');
      final ok = await confirmAction(
        context,
        title: label,
        message: _arabic
            ? 'شيك رقم ${text(row, 'chequeNumber')} بمبلغ ${formatAmount(asString(row['amount']))}. $book لا يمكن التراجع.'
            : 'Cheque ${text(row, 'chequeNumber')} for ${formatAmount(asString(row['amount']))}. $book This cannot be undone.',
        confirmLabel: _arabic ? 'تأكيد' : 'Confirm',
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    try {
      await ref.read(apiClientProvider).post(
        '/cheques/${text(row, 'id')}/$action',
        body: {'note': ?note, 'cashAccountId': ?accountId},
      );
      if (mounted) showMessage(context, _arabic ? 'تم' : 'Done');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) await ref.read(chequesProvider.notifier).refreshQuietly();
    }
  }

  Future<void> _create() async {
    final api = ref.read(apiClientProvider);
    List<Json> customers;
    List<Json> suppliers;
    List<Json> banks;
    try {
      customers = await api.getList('/parties/customers', query: {'pageSize': 200, 'page': 1});
      suppliers = await api.getList('/parties/suppliers', query: {'pageSize': 200, 'page': 1});
      banks = await api.getList('/cash/accounts');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    String name(Json r) => _arabic
        ? text(r, 'nameAr', fallback: text(r, 'nameEn'))
        : text(r, 'nameEn', fallback: text(r, 'nameAr'));
    List<FieldOption> opts(List<Json> rows) => [
      for (final r in rows)
        if (r['isActive'] != false && r['deletedAt'] == null) FieldOption(text(r, 'id'), '${text(r, 'code')} - ${name(r)}'),
    ];
    final bankOptions = [
      for (final b in banks)
        if (b['isActive'] != false && text(b, 'kind').toUpperCase() == 'BANK') FieldOption(text(b, 'id'), '${text(b, 'code')} - ${name(b)}'),
    ];
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'شيك جديد' : 'New cheque',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: {
        'direction': 'RECEIVED',
        'issueDate': DateTime.now().toIso8601String().substring(0, 10),
      },
      fields: [
        FieldSpec(
          'direction',
          _arabic ? 'النوع' : 'Type',
          kind: FieldKind.select,
          required: true,
          options: [
            FieldOption('RECEIVED', _arabic ? 'وارد من عميل' : 'Received from a customer'),
            FieldOption('ISSUED', _arabic ? 'صادر لمورد' : 'Issued to a supplier'),
          ],
        ),
        FieldSpec(
          'customerId',
          _arabic ? 'العميل' : 'Customer',
          kind: FieldKind.select,
          required: true,
          searchable: true,
          options: opts(customers),
          showWhenField: 'direction',
          showWhenValues: const {'RECEIVED'},
        ),
        FieldSpec(
          'supplierId',
          _arabic ? 'المورد' : 'Supplier',
          kind: FieldKind.select,
          required: true,
          searchable: true,
          options: opts(suppliers),
          showWhenField: 'direction',
          showWhenValues: const {'ISSUED'},
        ),
        FieldSpec('chequeNumber', _arabic ? 'رقم الشيك' : 'Cheque number', required: true, maxLength: 64),
        FieldSpec('bankName', _arabic ? 'اسم البنك' : 'Bank name', required: true, maxLength: 160),
        FieldSpec('amount', _arabic ? 'المبلغ' : 'Amount', kind: FieldKind.decimal, required: true,
          validator: (v) {
            final n = double.tryParse(v.trim());
            return n == null || n <= 0
                ? (_arabic ? 'اكتب مبلغاً أكبر من صفر.' : 'Enter an amount above zero.')
                : null;
          }),
        FieldSpec('issueDate', _arabic ? 'تاريخ الشيك' : 'Cheque date', kind: FieldKind.date, required: true),
        FieldSpec('dueDate', _arabic ? 'تاريخ الاستحقاق' : 'Due date', kind: FieldKind.date, required: true),
        FieldSpec(
          'cashAccountId',
          _arabic ? 'حساب البنك' : 'Bank account',
          kind: FieldKind.select,
          options: bankOptions,
          nullWhenEmpty: true,
          helper: _arabic
              ? 'إلزامي للشيك الصادر. للوارد يمكن اختياره عند التحصيل.'
              : 'Required for an issued cheque. For a received one it can be chosen at collection.',
        ),
        FieldSpec('notes', _arabic ? 'ملاحظات' : 'Notes', kind: FieldKind.multiline, maxLines: 2, maxLength: 2000, nullWhenEmpty: true),
      ],
      onSubmit: (values) async {
        final received = text(values, 'direction') == 'RECEIVED';
        await api.post('/cheques', body: {
          'direction': text(values, 'direction'),
          if (received) 'customerId': text(values, 'customerId') else 'supplierId': text(values, 'supplierId'),
          'chequeNumber': text(values, 'chequeNumber').trim(),
          'bankName': text(values, 'bankName').trim(),
          'amount': text(values, 'amount').trim(),
          'issueDate': text(values, 'issueDate'),
          'dueDate': text(values, 'dueDate'),
          if (values['cashAccountId'] != null && text(values, 'cashAccountId').isNotEmpty)
            'cashAccountId': text(values, 'cashAccountId'),
          if (values['notes'] != null) 'notes': text(values, 'notes'),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم تسجيل الشيك.' : 'The cheque was registered.');
      ref.invalidate(chequesProvider);
    }
  }
}
