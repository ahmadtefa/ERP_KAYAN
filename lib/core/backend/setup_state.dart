/// Existing company or user data without an active company account must
/// never be treated as a fresh install. Preserve it and use authorised recovery.
const setupRecoveryMessageAr =
    'توجد بيانات شركة أو حسابات مستخدمين محفوظة، لكن لا يوجد حساب شركة فعّال '
    'يمكنه تسجيل الدخول. احتفظ بالبيانات واستعد الوصول من خلال إجراء معتمد.';
const setupRecoveryMessageEn =
    'Existing company or user data was found, but no active company account '
    'can sign in. Preserve the data and use the authorised recovery process.';

bool setupRequiresRecovery({String? preparationState, Object? healthValue}) =>
    preparationState == 'recovery_required' || healthValue == true;
