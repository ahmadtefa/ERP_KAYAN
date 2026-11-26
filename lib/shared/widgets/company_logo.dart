import 'package:flutter/material.dart';

import 'authorized_company_logo.dart';

/// Displays a server-provided company mark and falls back when it is absent.
class CompanyLogo extends StatelessWidget {
  const CompanyLogo({super.key, required this.url, this.size = 42});

  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) {
      return Icon(
        Icons.account_balance,
        size: size,
        color: Theme.of(context).colorScheme.primary,
      );
    }
    return AuthorizedCompanyLogo(
      url: url,
      width: size,
      height: size,
      fallback: Icon(
        Icons.account_balance,
        size: size,
        color: Theme.of(context).colorScheme.primary,
      ),
    );
  }
}
