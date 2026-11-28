import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/design_tokens.dart';
import '../../features/auth/domain/entities/app_user.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import 'operations_registry.dart';

/// The Inputs Centre (المدخلات) and the Outputs Centre (المخرجات): one card
/// grid over the shared operations registry, so both centres stay in step.
///
/// Only operations the signed-in user may open are shown; favourites and
/// most-used are per user and survive logout and restart.
class OperationsCenterScreen extends ConsumerStatefulWidget {
  const OperationsCenterScreen({super.key, required this.kind, this.user});

  final OpsKind kind;
  final AppUser? user;

  @override
  ConsumerState<OperationsCenterScreen> createState() =>
      _OperationsCenterScreenState();
}

class _OperationsCenterScreenState extends ConsumerState<OperationsCenterScreen> {
  final _search = TextEditingController();
  String _query = '';
  Set<String> _favorites = {};
  Map<String, int> _usage = {};

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  AppUser? get _user => widget.user ?? ref.read(currentUserProvider);

  OpsPrefs get _prefs {
    final user = _user;
    return OpsPrefs(user?.id ?? 'anon', user?.companyId ?? 'none');
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final favorites = await _prefs.favorites(widget.kind);
    final usage = await _prefs.usage(widget.kind);
    if (!mounted) return;
    setState(() {
      _favorites = favorites;
      _usage = usage;
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _allowed(OpsItem item, AppUser? user) =>
      user != null && item.allowed(user.can);

  List<OpsItem> _matches(OpsItem item) {
    if (_query.isEmpty) return [item];
    final q = _query.toLowerCase();
    final hit = item.ar.toLowerCase().contains(q) ||
        item.en.toLowerCase().contains(q) ||
        item.groupAr.contains(_query) ||
        item.groupEn.toLowerCase().contains(q);
    return hit ? [item] : const [];
  }

  Future<void> _open(OpsItem item) async {
    await _prefs.recordUse(widget.kind, item.id);
    if (!mounted) return;
    setState(() {
      _usage = {..._usage, item.id: (_usage[item.id] ?? 0) + 1};
    });
    // Push keeps the centre underneath, so closing the operation lands the
    // user back here with the search untouched.
    context.push(item.opensForm ? item.newFormPath : item.path);
  }

  Future<void> _toggleFavorite(OpsItem item) async {
    final pinned = !_favorites.contains(item.id);
    setState(() {
      if (pinned) {
        _favorites = {..._favorites, item.id};
      } else {
        _favorites = {..._favorites}..remove(item.id);
      }
    });
    await _prefs.setFavorite(widget.kind, item.id, pinned);
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.user ?? ref.watch(currentUserProvider);
    final items = OperationsRegistry.forKind(widget.kind)
        .where((item) => _allowed(item, user))
        .toList();
    final arabic = _arabic;
    final favoriteItems = items
        .where((item) => _favorites.contains(item.id))
        .expand(_matches)
        .toList();
    final usedItems = items.where((item) => (_usage[item.id] ?? 0) > 0).toList()
      ..sort((a, b) => (_usage[b.id] ?? 0).compareTo(_usage[a.id] ?? 0));
    final mostUsed = usedItems.expand(_matches).take(6).toList();

    final grouped = <String, List<OpsItem>>{};
    for (final item in items.expand(_matches)) {
      grouped.putIfAbsent(item.group(arabic), () => []).add(item);
    }

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        _SearchBar(
          controller: _search,
          hint: widget.kind == OpsKind.entry
              ? (arabic ? 'ابحث في عمليات الإدخال…' : 'Search entry operations…')
              : (arabic ? 'ابحث في التقارير والمخرجات…' : 'Search reports and outputs…'),
          helper: arabic
              ? 'اكتب جزءاً من اسم العملية، ثم اضغط على البطاقة لفتحها.'
              : 'Type part of an operation name, then tap its card to open it.',
          onChanged: (value) => setState(() => _query = value.trim()),
        ),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
            child: Center(
              child: Text(
                arabic
                    ? 'لا توجد لديك صلاحية لعرض عمليات هذا القسم. اطلب من مدير النظام إعطاءك الصلاحية.'
                    : 'You do not have permission to view operations in this section. Ask your system administrator to give you access.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          )
        else if (_query.isNotEmpty && grouped.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
            child: Center(
              child: Text(
                arabic
                    ? 'لا توجد نتائج مطابقة. جرّب كلمة أخرى أو امسح البحث.'
                    : 'No matching results. Try another word or clear the search.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        if (favoriteItems.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          _StripHeader(
            icon: Icons.push_pin_rounded,
            label: arabic ? 'المفضلة' : 'Favourites',
          ),
          const SizedBox(height: AppSpacing.sm),
          _CardGrid(
            items: favoriteItems,
            arabic: arabic,
            favorites: _favorites,
            usage: _usage,
            onOpen: _open,
            onToggleFavorite: _toggleFavorite,
          ),
        ],
        if (mostUsed.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          _StripHeader(
            icon: Icons.trending_up_rounded,
            label: arabic ? 'الأكثر استخداماً' : 'Most used',
          ),
          const SizedBox(height: AppSpacing.sm),
          _CardGrid(
            items: mostUsed,
            arabic: arabic,
            favorites: _favorites,
            usage: _usage,
            onOpen: _open,
            onToggleFavorite: _toggleFavorite,
          ),
        ],
        for (final entry in grouped.entries) ...[
          const SizedBox(height: AppSpacing.md),
          _StripHeader(
            icon: Icons.folder_rounded,
            label: entry.key,
            color: entry.value.first.color,
          ),
          const SizedBox(height: AppSpacing.sm),
          _CardGrid(
            items: entry.value,
            arabic: arabic,
            favorites: _favorites,
            usage: _usage,
            onOpen: _open,
            onToggleFavorite: _toggleFavorite,
          ),
        ],
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.controller,
    required this.hint,
    required this.helper,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String hint;
  final String helper;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return TextField(
      controller: controller,
      onChanged: onChanged,
      decoration: InputDecoration(
        hintText: hint,
        helperText: helper,
        helperMaxLines: 1,
        prefixIcon: const Icon(Icons.search_rounded),
        isDense: true,
        filled: true,
        fillColor: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: 0.45),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}

class _StripHeader extends StatelessWidget {
  const _StripHeader({required this.icon, required this.label, this.color});

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = color ?? theme.colorScheme.primary;
    return Row(
      children: [
        Icon(icon, size: 16, color: accent),
        const SizedBox(width: 6),
        Text(
          label,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
            color: accent,
          ),
        ),
      ],
    );
  }
}

class _CardGrid extends StatelessWidget {
  const _CardGrid({
    required this.items,
    required this.arabic,
    required this.favorites,
    required this.usage,
    required this.onOpen,
    required this.onToggleFavorite,
  });

  final List<OpsItem> items;
  final bool arabic;
  final Set<String> favorites;
  final Map<String, int> usage;
  final void Function(OpsItem) onOpen;
  final void Function(OpsItem) onToggleFavorite;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1400 ? 4 : (width >= 1000 ? 3 : (width >= 640 ? 2 : 1));
    final rows = <List<OpsItem>>[];
    for (var i = 0; i < items.length; i += columns) {
      rows.add(items.sublist(i, i + columns > items.length ? items.length : i + columns));
    }
    return Column(
      children: [
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in row)
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                        right: arabic ? AppSpacing.sm : 0,
                        left: arabic ? 0 : AppSpacing.sm,
                      ),
                      child: _OpsCard(
                        item: item,
                        arabic: arabic,
                        pinned: favorites.contains(item.id),
                        used: usage[item.id] ?? 0,
                        onOpen: onOpen,
                        onToggleFavorite: onToggleFavorite,
                      ),
                    ),
                  ),
                for (var i = row.length; i < columns; i++) const Expanded(child: SizedBox()),
              ],
            ),
          ),
      ],
    );
  }
}

class _OpsCard extends StatelessWidget {
  const _OpsCard({
    required this.item,
    required this.arabic,
    required this.pinned,
    required this.used,
    required this.onOpen,
    required this.onToggleFavorite,
  });

  final OpsItem item;
  final bool arabic;
  final bool pinned;
  final int used;
  final void Function(OpsItem) onOpen;
  final void Function(OpsItem) onToggleFavorite;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onOpen(item),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(item.icon, size: 18, color: item.color),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label(arabic),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (used > 0)
                      Text(
                        arabic ? 'استُخدم $used مرة' : 'used $used×',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                  ],
                ),
              ),
              IconButton(
                tooltip: pinned
                    ? (arabic ? 'إزالة من المفضلة' : 'Unpin')
                    : (arabic ? 'تثبيت في المفضلة' : 'Pin'),
                visualDensity: VisualDensity.compact,
                iconSize: 16,
                onPressed: () => onToggleFavorite(item),
                icon: Icon(
                  pinned ? Icons.push_pin : Icons.push_pin_outlined,
                  color: pinned ? item.color : theme.colorScheme.outline,
                ),
              ),
              Icon(
                arabic ? Icons.chevron_left_rounded : Icons.chevron_right_rounded,
                size: 18,
                color: theme.colorScheme.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
