# KAYAN ERP branding and document exports

## Application logo

The approved application logo is the repository-root file `1.png`. Flutter bundles it for the signed-in navigation shell. Before producing release builds, regenerate the native and web icon files from that source:

```bash
python -m pip install Pillow
python scripts/generate_app_icons.py
flutter pub get
flutter analyze
flutter test
flutter build web --release
```

The Windows installer script also regenerates the icons, and CI regenerates them before web and Windows release builds. The Linux desktop bundle copies the source logo beside the executable and uses it for the native window icon.

## Company identity on printouts and exports

The document header uses the company profile saved in **Settings → Company profile**:
- Company name in the selected language
- Uploaded company logo, when configured
- Tax registration number and commercial registration number
- Phone, email, address, and reporting currency

The print page and PDF embed the logo so the printed document does not depend on a remote image. Excel workbooks embed the logo and keep amounts numeric. CSV files include all available textual company details; the CSV format cannot embed images.

If the logo does not appear in a document, open the company profile, upload the company's logo, save, and retry the export.

## Export coverage

Reports and supported list screens offer print, PDF when the server has a PDF-capable browser, Excel (.xlsx), and CSV. Invoice details keep their print/export controls directly inside the detail view. Cash/bank accounts, vouchers, and transfers each have their own list export, protected by the same read permissions as their screens.
