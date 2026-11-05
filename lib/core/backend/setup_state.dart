/// An existing company without users must never be treated as a fresh install.
/// Restore access through an authorised recovery process without deleting data.
const setupRecoveryMessageAr =
    'توجد شركة محفوظة لكن لا يوجد حساب مستخدم فعّال لهذه الشركة. '
    'احتفظ بالبيانات وتواصل مع المسؤول لاستعادة الوصول بطريقة معتمدة.';
const setupRecoveryMessageEn =
    'An existing company has no active user account. Preserve the data '
    'and contact your administrator for authorised access recovery.';

bool setupRequiresRecovery({String? preparationState, Object? healthValue}) =>
    preparationState == 'recovery_required' || healthValue == true;
