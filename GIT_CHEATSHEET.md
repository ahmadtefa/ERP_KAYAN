# أوامر Git — مرجع سريع

كل الأوامر دي بتتكتب في **Terminal** جوه VS Code.
افتحه بـ `Ctrl + ~` (أو من القائمة: Terminal ← New Terminal).

> ⚠️ **لو السطر بيبدأ بـ `PS`** يبقى إنت على **PowerShell**.
> ساعتها لازم تكتب ``.\` قبل أي ملف، مثال: `.\scripts\pull-and-run.bat`
> أما أوامر `git` و `flutter` و `npm` فبتتكتب عادي في الاتنين.

---

## أول مرة فقط: اسحب المشروع

```cmd
cd %USERPROFILE%\Desktop
git clone https://github.com/mohamedkamel78/ERP_KAYAN.git
cd ERP_KAYAN
code .
```

`code .` هتفتح المشروع في VS Code على طول.

> **لو `code` مش متعرف:** افتح VS Code ← File ← Open Folder ← اختار `ERP_KAYAN`.

---

## بعد كده: اسحب آخر التعديلات

```cmd
cd %USERPROFILE%\Desktop\ERP_KAYAN
git pull
```

ده كل حاجة. `git pull` = يسحب آخر التعديلات من GitHub.

---

## الطريقة من داخل VS Code (بدون أوامر)

1. افتح المشروع: **File ← Open Folder** ← اختار `ERP_KAYAN`
2. اضغط `Ctrl + Shift + G` (لوحة Source Control)
3. اضغط **...** فوق ← **Pull**

أو من الشريط السفلي: اضغط أيقونة الأسهم الدائرية 🔄

---

## سحب وتشغيل بأمر واحد

```cmd
scripts\pull-and-run.bat
```

بيسحب آخر التعديلات، ويشغّل السيرفر لو مش شغال، ويفتح الواجهة في Chrome.

---

## التأكد إن السحب نجح

```cmd
git log --oneline -5
```

المفروض تشوف آخر commit. لو الرقم مطابق لآخر حاجة على GitHub يبقى تمام.

```cmd
git status
```

لو مكتوب `Your branch is up to date with 'origin/main'` يبقى كل حاجة محدَّثة.

---

## لو ظهرت مشكلة

### "Your local changes would be overwritten"

ده معناه إن فيه تعديلات محلية عندك. لو مش محتاجها:

```cmd
git stash
git pull
```

ولو عايز ترجّعها بعدين: `git stash pop`

### حبيت تبدأ من الأول (هيمسح أي تعديل محلي)

```cmd
git fetch origin
git reset --hard origin/main
```

### "not a git repository"

إنت في المجلد الغلط. اتأكد إنك جوه `ERP_KAYAN`:

```cmd
cd %USERPROFILE%\Desktop\ERP_KAYAN
```

### "git is not recognized"

Git مش متثبت أو مش في الـ PATH. نصّبه من:
https://git-scm.com/download/win
وبعدين اقفل VS Code وافتحه تاني.

---

## أوامر مفيدة كمان

| الأمر | بيعمل إيه |
| --- | --- |
| `git log --oneline -10` | آخر 10 تعديلات |
| `git status` | إيه اللي اتغير عندك |
| `git branch` | إنت على أي فرع |
| `git diff` | تفاصيل التعديلات |
| `git pull --ff-only` | سحب آمن — لو فيه تعارض يرفض وبيقولك |

---

## إزاي تعرف إن فيه تحديث جديد من غير ما تسحب؟

```cmd
git fetch
git status
```

لو مكتوب `Your branch is behind 'origin/main'` يبقى فيه تحديث — اسحب بـ `git pull`.
