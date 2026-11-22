/// One choice in a named selection field.
class FieldOption {
  const FieldOption(this.value, this.label, {this.enabled = true});

  final String value;
  final String label;

  /// An existing unavailable value can stay visible without becoming a new choice.
  final bool enabled;
}
