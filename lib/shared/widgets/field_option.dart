/// One choice in a named selection field.
class FieldOption {
  const FieldOption(this.value, this.label, {this.enabled = true, this.heading});

  final String value;
  final String label;

  /// An existing unavailable value can stay visible without becoming a new choice.
  final bool enabled;

  /// A short heading printed above this option in a dropdown list. Only the
  /// list is affected: the option stays one ordinary choice.
  final String? heading;
}
