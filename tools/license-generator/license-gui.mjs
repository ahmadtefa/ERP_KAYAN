/**
 * The operator's window on the generator: a small local web page served by the
 * same process, opened in the default browser.
 *
 * Why a browser and not a native toolkit: the tool must run on a Windows
 * machine with nothing installed. A local page needs no GUI framework, no
 * runtime besides the one the tool already is, and no network: the server
 * answers on 127.0.0.1 only, with a token that changes on every start, so
 * another local program cannot drive it.
 *
 * This module holds no licensing logic. Every action is handed to `api`, which
 * `kayan-license.mjs` builds out of the same functions the command line uses,
 * so the two front ends cannot drift apart. The private key never crosses this
 * boundary: responses carry licence details, key ids and fingerprints only.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const MAX_BODY = 64 * 1024;

/** Everything the page needs, in one string so the packaged binary is one file. */
const GUI_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KAYAN — مولّد مفاتيح الترخيص</title>
<style>
:root{--bg:#f4f6f9;--card:#fff;--ink:#12203a;--muted:#5b6b86;--line:#d8e0ec;--brand:#1b4d8f;--ok:#1c7a4a;--bad:#a52121;--warn:#8a5a00}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI",Tahoma,Arial,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--brand);color:#fff;padding:14px 22px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0;font-weight:600}
header .meta{font-size:12px;opacity:.9;direction:ltr}
main{max-width:1100px;margin:18px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
.card h2{margin:0 0 14px;font-size:16px;color:var(--brand)}
label{display:block;font-size:13px;margin:10px 0 4px;color:var(--muted)}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:7px;font:inherit;background:#fff;color:var(--ink)}
textarea{min-height:64px;resize:vertical;direction:ltr;font-family:Consolas,monospace;font-size:12px}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
button{border:0;border-radius:7px;padding:10px 16px;font:inherit;cursor:pointer;background:var(--brand);color:#fff}
button.secondary{background:#e7edf6;color:var(--brand)}
button.danger{background:#f6e7e7;color:var(--bad)}
button:disabled{opacity:.55;cursor:not-allowed}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.tabs button{background:#e7edf6;color:var(--brand)}
.tabs button.active{background:var(--brand);color:#fff}
.hidden{display:none!important}
.msg{margin-top:12px;padding:11px 13px;border-radius:8px;font-size:14px;white-space:pre-wrap}
.msg.ok{background:#e8f5ee;color:var(--ok);border:1px solid #b9dfcb}
.msg.bad{background:#fdecec;color:var(--bad);border:1px solid #f3c2c2}
.msg.info{background:#eef3fb;color:var(--brand);border:1px solid #cddcf2}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 9px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}
code{font-family:Consolas,monospace;font-size:12px;direction:ltr;display:inline-block;word-break:break-all}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;background:#e7edf6;color:var(--brand)}
.badge.ok{background:#e8f5ee;color:var(--ok)}
.badge.bad{background:#fdecec;color:var(--bad)}
.keybox{min-height:96px}
.note{font-size:12px;color:var(--muted);line-height:1.7}
footer{max-width:1100px;margin:0 auto 30px;padding:0 16px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<header>
  <h1>مولّد مفاتيح ترخيص كيان — KAYAN key generator</h1>
  <span class="meta" id="where"></span>
</header>
<main>
  <div class="card" id="keycard">
    <h2>حالة مفتاح التوقيع — signing key</h2>
    <div id="keystate"></div>
    <div class="actions" id="initwrap">
      <button class="secondary" id="initbtn">إنشاء زوج مفاتيح جديد — create key pair</button>
    </div>
    <div class="msg info" id="initmsg" style="display:none"></div>
  </div>

  <div class="tabs">
    <button data-tab="issue" class="active">إصدار مفتاح — issue</button>
    <button data-tab="register">السجل — register</button>
    <button data-tab="inspect">فحص مفتاح — inspect</button>
  </div>

  <section class="card" id="tab-issue">
    <h2>إصدار مفتاح / Issue a key</h2>
    <div class="card" id="create-licence-card" style="background:#f8faff">
      <h2>تسجيل ترخيص جديد — Create a licence</h2>
      <div class="note" id="licence-hint">سجّل ترخيصًا أولًا قبل إصدار أي مفتاح.</div>
      <div class="row">
        <div>
          <label for="licence-ref">مرجع أو ملاحظة إدارية — reference (optional)</label>
          <input id="licence-ref" maxlength="160" placeholder="مثال: عقد 2026-001">
        </div>
        <div>
          <label for="licence-seats">حد المستخدمين — seat limit</label>
          <input id="licence-seats" type="number" min="1" step="1" value="5" dir="ltr" required>
        </div>
        <div>
          <label for="licence-term">مدة الترخيص — term</label>
          <select id="licence-term">
            <option value="1m">شهر — 1 month</option>
            <option value="6m">6 أشهر — 6 months</option>
            <option value="1y" selected>سنة — 1 year</option>
            <option value="2y">سنتان — 2 years</option>
            <option value="3y">3 سنوات — 3 years</option>
            <option value="P">دائم — perpetual</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" id="create-licence">تسجيل الترخيص — create licence</button>
      </div>
      <div class="msg" id="create-licence-msg" style="display:none"></div>
    </div>
    <div class="row">
      <div>
        <label>نوع المفتاح — operation</label>
        <select id="type">
          <option value="ACTIVATION">ACTIVATION — تفعيل جهاز</option>
          <option value="RENEWAL">RENEWAL — تجديد</option>
          <option value="SEATS">SEATS — زيادة/سقف مستخدمين</option>
          <option value="TRANSFER">TRANSFER — نقل إلى جهاز آخر</option>
        </select>
      </div>
      <div>
        <label>الترخيص — licence</label>
        <select id="licence"></select>
      </div>
    </div>

    <label id="reqlabel">كود الطلب من شاشة العميل (اختياري) — request code KYNREQ1.…</label>
    <textarea id="request" placeholder="KYNREQ1.…"></textarea>
    <div class="actions" style="margin-top:8px">
      <button class="secondary" id="readreq">قراءة الكود — read request</button>
    </div>

    <div class="row">
      <div id="machinewrap">
        <label>معرّف الجهاز — machine id</label>
        <input id="machine" placeholder="KM-XXXX-XXXX-XXXX-XXXX" dir="ltr">
      </div>
      <div id="termwrap">
        <label>المدة — duration</label>
        <select id="term">
          <option value="1m">شهر — 1 month</option>
          <option value="3m">3 أشهر — 3 months</option>
          <option value="6m">6 أشهر — 6 months</option>
          <option value="1y" selected>سنة — 1 year</option>
          <option value="2y">سنتان — 2 years</option>
          <option value="3y">3 سنوات — 3 years</option>
          <option value="P">دائم — perpetual</option>
        </select>
      </div>
      <div id="seatswrap">
        <label>حد المستخدمين — seat limit</label>
        <input id="seats" type="number" min="1" step="1" value="5" dir="ltr">
      </div>
    </div>

    <div class="row" id="seatadjust">
      <div>
        <label>الزيادة — increase by</label>
        <input id="increase" type="number" min="1" step="1" value="1" dir="ltr">
      </div>
      <div>
        <label>أو سقف جديد — new cap</label>
        <input id="cap" type="number" min="1" step="1" placeholder="" dir="ltr">
      </div>
    </div>

    <div class="row">
      <div id="usedwrap">
        <label>المستخدمون الحاليون (للنقل) — seats in use at transfer</label>
        <input id="used" type="number" min="0" step="1" value="0" dir="ltr">
      </div>
      <div>
        <label>ملاحظة إدارية (اختياري، تُكتب داخل المفتاح) — note</label>
        <input id="note" placeholder="INV-2026-001">
      </div>
    </div>

    <div class="actions">
      <button class="secondary" id="preview">معاينة قبل الإصدار — preview</button>
      <button id="issue">إصدار المفتاح — issue key</button>
    </div>
    <div class="msg" id="issuemsg" style="display:none"></div>

    <div id="result" class="hidden">
      <label>المفتاح الموقّع — signed key</label>
      <textarea id="keytext" class="keybox" readonly></textarea>
      <div class="actions">
        <button id="copy">نسخ — copy</button>
        <button class="secondary" id="save">حفظ في ملف — save file</button>
      </div>
      <div class="msg info" id="summary"></div>
    </div>
  </section>

  <section class="card hidden" id="tab-register">
    <h2>السجل / Register</h2>
    <div class="actions" style="margin-top:0">
      <button class="secondary" id="refresh">تحديث — refresh</button>
    </div>
    <div id="licences"></div>
    <h2 style="margin-top:22px">آخر العمليات — recent audit entries</h2>
    <div class="note">يسجّل الملف <code id="auditpath">audit.log</code> العملية والوقت ومعرّف المفتاح؛ ولا يسجّل المفتاح الخاص ولا نص المفتاح ولا الملاحظات.</div>
    <div id="audit"></div>
  </section>

  <section class="card hidden" id="tab-inspect">
    <h2>فحص مفتاح موقّع / Inspect a signed key</h2>
    <label>الصق المفتاح — paste the key</label>
    <textarea id="inspectkey" placeholder="KYN1.…"></textarea>
    <div class="actions">
      <button id="verify">فحص — verify</button>
    </div>
    <div class="msg" id="verifymsg" style="display:none"></div>
    <div id="verifyout"></div>
  </section>
</main>
<footer>
  يعمل محليًا فقط على 127.0.0.1. لا يخرج أي مفتاح خاص من هذا البرنامج، ولا يُرسل شيء عبر الشبكة.
  Local only. No private key leaves this program and nothing is sent over the network.
</footer>
<script>
(function () {
  var token = (location.hash || '').replace(/^#/, '');
  var state = { licences: [], keys: [] };
  var $ = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function show(el, text, kind) {
    el.textContent = text;
    el.className = 'msg ' + (kind || 'info');
    el.style.display = 'block';
  }

  function hide(el) { el.style.display = 'none'; }

  function api(path, body) {
    var options = { method: body ? 'POST' : 'GET', headers: { 'x-kayan-token': token } };
    if (body) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return { error: 'unreadable response' }; })
        .then(function (data) {
          if (!response.ok) { throw new Error(data.error || ('HTTP ' + response.status)); }
          return data;
        });
    });
  }

  function licenceLabel(licence) {
    var bits = [licence.licenseId];
    if (licence.ref) bits.push(licence.ref);
    bits.push(licence.seats + ' seats');
    bits.push(licence.term === null ? 'perpetual' : licence.term + 'm');
    return bits.join(' — ');
  }

  var creatingLicence = false;

  function updateIssueAvailability() {
    var hasKey = Boolean(state.hasKey);
    var hasLicence = state.licences.length > 0;
    $('create-licence').disabled = !hasKey || creatingLicence;
    $('preview').disabled = !hasKey || !hasLicence;
    $('issue').disabled = !hasKey || !hasLicence;
    $('licence-hint').textContent = !hasKey
      ? 'أنشئ مفتاح التوقيع أولًا من البطاقة أعلى الصفحة، أو افتح مجلد المفاتيح الصحيح. — Create/open the signing key first.'
      : !hasLicence
        ? 'السجل فارغ: سجّل ترخيصًا هنا أولًا؛ لن يتم إرسال طلب إصدار فارغ. — Register a licence here before issuing.'
        : 'يمكنك تسجيل تراخيص إضافية في أي وقت. — You can register additional licences at any time.';
  }

  function fillLicences() {
    var select = $('licence');
    var current = select.value;
    select.innerHTML = '';
    if (!state.licences.length) {
      var option = document.createElement('option');
      option.value = '';
      option.textContent = 'لا يوجد ترخيص مسجّل — create one first';
      select.appendChild(option);
      updateIssueAvailability();
      return;
    }
    state.licences.forEach(function (licence) {
      var option = document.createElement('option');
      option.value = licence.licenseId;
      option.textContent = licenceLabel(licence);
      select.appendChild(option);
    });
    if (current) select.value = current;
    onLicenceChange();
    updateIssueAvailability();
  }

  function selectedLicence() {
    var id = $('licence').value;
    for (var index = 0; index < state.licences.length; index += 1) {
      if (state.licences[index].licenseId === id) return state.licences[index];
    }
    return null;
  }

  function onLicenceChange() {
    var licence = selectedLicence();
    if (!licence) return;
    $('seats').value = licence.seats;
    $('used').value = licence.seatsUsed;
    $('term').value = licence.term === null ? 'P' : (licence.term % 12 === 0 ? (licence.term / 12) + 'y' : licence.term + 'm');
  }

  function syncType() {
    var type = $('type').value;
    $('machinewrap').classList.toggle('hidden', type === 'RENEWAL' || type === 'SEATS');
    $('termwrap').classList.toggle('hidden', type === 'SEATS' || type === 'TRANSFER');
    $('seatswrap').classList.toggle('hidden', type !== 'ACTIVATION');
    $('seatadjust').classList.toggle('hidden', type !== 'SEATS');
    $('usedwrap').classList.toggle('hidden', type !== 'TRANSFER');
    $('reqlabel').textContent = type === 'ACTIVATION' || type === 'TRANSFER'
      ? 'كود الطلب من شاشة العميل (اختياري) — request code KYNREQ1.…'
      : 'كود الطلب غير مطلوب لهذه العملية — not needed for this operation';
    $('request').disabled = !(type === 'ACTIVATION' || type === 'TRANSFER');
  }

  function renderState(payload) {
    $('where').textContent = payload.home;
    var box = $('keystate');
    if (!payload.hasKey) {
      box.innerHTML = '<div class="msg bad">لا يوجد مفتاح توقيع في هذا المجلد. أنشئ زوجًا جديدًا أو افتح الأداة على مجلد النسخة الاحتياطية. ' +
        'No signing key in this folder.</div>';
      $('initwrap').style.display = 'flex';
    } else {
      box.innerHTML = '<div class="note">البصمة — fingerprint: <code>' + esc(payload.fingerprint) +
        '</code><br>المجلد — folder: <code>' + esc(payload.home) + '</code><br>' +
        'قارن البصمة بما تعرضه شاشة الترخيص في البرنامج قبل إرسال أي مفتاح.</div>';
      $('initwrap').style.display = 'none';
    }
    $('auditpath').textContent = payload.home + '\\\\audit.log';
  }

  function refresh() {
    return api('/api/state').then(function (payload) {
      state = payload;
      renderState(payload);
      fillLicences();
      renderRegister();
      renderAudit();
    }).catch(function (error) { show($('issuemsg'), error.message, 'bad'); });
  }

  function renderAudit() {
    var rows = (state.audit || []).slice().reverse();
    if (!rows.length) { $('audit').innerHTML = '<div class="note">لا توجد عمليات بعد.</div>'; return; }
    var html = '<table><tr><th>الوقت — time</th><th>العملية — action</th><th>المفتاح — key</th><th>النتيجة — result</th></tr>';
    rows.forEach(function (row) {
      html += '<tr><td>' + esc(row.at) + '</td><td>' + esc(row.action) +
        (row.type ? ' / ' + esc(row.type) : '') + '</td><td><code>' +
        esc(row.keyId || row.licenseId || '') + '</code></td><td>' + esc(row.result || '') + '</td></tr>';
    });
    $('audit').innerHTML = html + '</table>';
  }

  function renderRegister() {
    if (!state.licences.length) {
      $('licences').innerHTML = '<div class="note">السجل فارغ. استخدم نموذج «تسجيل ترخيص جديد» في تبويب إصدار المفتاح؛ لن تحتاج إلى سطر الأوامر. — Register a licence in the issue tab; no command line needed.</div>';
      return;
    }
    var html = '';
    state.licences.forEach(function (licence) {
      var keys = (state.keys || []).filter(function (key) { return key.licenseId === licence.licenseId; });
      html += '<div style="margin-top:14px"><strong><code>' + esc(licence.licenseId) + '</code></strong> ' +
        '<span class="badge">' + esc(licence.status) + '</span> ' +
        '<span class="badge">' + esc(licence.seats) + ' seats / used ' + esc(licence.seatsUsed) + '</span> ' +
        '<span class="badge">' + esc(licence.term === null ? 'perpetual' : licence.term + ' months') + '</span> ' +
        '<div class="note">' + esc(licence.ref || '(no note)') + ' · machine ' + esc(licence.machineId || '—') +
        ' · expires ' + esc(licence.expiresAt || 'never') + '</div>';
      if (keys.length) {
        html += '<table><tr><th>key id</th><th>type</th><th>status</th><th>issued</th><th></th></tr>';
        keys.forEach(function (key) {
          html += '<tr><td><code>' + esc(key.keyId) + '</code></td><td>' + esc(key.type) + '</td><td>' +
            esc(key.status) + '</td><td>' + esc(String(key.issuedAt).slice(0, 10)) + '</td><td>' +
            (key.status === 'issued' ? '<button class="secondary" data-used="' + esc(key.keyId) + '">mark used</button> ' : '') +
            (key.status === 'revoked' ? '' : '<button class="danger" data-revoke="' + esc(key.keyId) + '">revoke</button>') +
            '</td></tr>';
        });
        html += '</table>';
      }
      html += '</div>';
    });
    $('licences').innerHTML = html;
  }

  $('licences').addEventListener('click', function (event) {
    var used = event.target.getAttribute('data-used');
    var revoked = event.target.getAttribute('data-revoke');
    if (used) {
      api('/api/mark-used', { keyId: used }).then(refresh)
        .catch(function (error) { show($('issuemsg'), error.message, 'bad'); });
    }
    if (revoked) {
      var reason = prompt('سبب السحب — reason for revoking');
      if (!reason) return;
      api('/api/revoke', { keyId: revoked, reason: reason }).then(refresh)
        .catch(function (error) { show($('issuemsg'), error.message, 'bad'); });
    }
  });

  function issueBody(dryRun) {
    var body = {
      type: $('type').value,
      licenceId: $('licence').value,
      machineId: $('machine').value.trim() || null,
      request: $('request').value.trim() || null,
      note: $('note').value.trim() || null,
      dryRun: !!dryRun
    };
    var type = body.type;
    if (type === 'ACTIVATION') body.seats = Number($('seats').value);
    if (type !== 'SEATS' && type !== 'TRANSFER') body.term = $('term').value;
    if (type === 'SEATS') {
      var capText = $('cap').value.trim();
      if (capText) body.cap = Number(capText); else body.increase = Number($('increase').value);
    }
    if (type === 'TRANSFER') body.used = Number($('used').value);
    return body;
  }

  $('create-licence').addEventListener('click', function () {
    if (!state.hasKey) {
      show($('create-licence-msg'), 'أنشئ مفتاح التوقيع أولًا. — Create the signing key first.', 'bad');
      return;
    }
    if (creatingLicence) return;
    var seats = Number($('licence-seats').value);
    if (!Number.isSafeInteger(seats) || seats < 1) {
      show($('create-licence-msg'), 'حد المستخدمين يجب أن يكون عددًا صحيحًا لا يقل عن 1. — Seat limit must be a whole number of at least 1.', 'bad');
      return;
    }
    creatingLicence = true;
    updateIssueAvailability();
    api('/api/licence-create', {
      ref: $('licence-ref').value.trim(),
      seats: seats,
      term: $('licence-term').value
    }).then(function (payload) {
      return refresh().then(function () {
        if (payload.licence && payload.licence.licenseId) {
          $('licence').value = payload.licence.licenseId;
          onLicenceChange();
        }
        show($('create-licence-msg'),
          'تم تسجيل الترخيص بنجاح: ' + (payload.licence && payload.licence.licenseId || '') +
          ' — Licence registered. You can now issue a key.', 'ok');
      });
    }).catch(function (error) {
      show($('create-licence-msg'), error.message, 'bad');
    }).then(function () {
      creatingLicence = false;
      updateIssueAvailability();
    });
  });

  $('preview').addEventListener('click', function () {
    hide($('result'));
    if (!selectedLicence()) {
      show($('issuemsg'), 'لا يوجد ترخيص صالح محدد. سجّل ترخيصًا أولًا. — Select or create a licence first.', 'bad');
      updateIssueAvailability();
      return;
    }
    api('/api/issue', issueBody(true)).then(function (payload) {
      show($('issuemsg'), 'معاينة فقط، لم يُصدر مفتاح — preview only, nothing signed.\\n\\n' +
        JSON.stringify(payload.preview, null, 2), 'info');
    }).catch(function (error) { show($('issuemsg'), error.message, 'bad'); });
  });

  $('issue').addEventListener('click', function () {
    if (!selectedLicence()) {
      show($('issuemsg'), 'لا يوجد ترخيص صالح محدد. سجّل ترخيصًا أولًا. — Select or create a licence first.', 'bad');
      updateIssueAvailability();
      return;
    }
    api('/api/issue', issueBody(false)).then(function (payload) {
      $('keytext').value = payload.key;
      $('summary').textContent = payload.summary;
      $('result').classList.remove('hidden');
      $('result').style.display = 'block';
      // Keep the signed key visible even if a browser/layout issue hides the result panel.
      show($('issuemsg'),
        'تم إصدار المفتاح. انسخه كاملًا وأرسله للعميل. — Key issued; send it whole.\\n\\n' + payload.key,
        'ok');
      $('result').scrollIntoView({ block: 'center' });
      refresh();
    }).catch(function (error) {
      hide($('result'));
      show($('issuemsg'), error.message, 'bad');
    });
  });

  $('copy').addEventListener('click', function () {
    var text = $('keytext').value;
    var done = function () { show($('issuemsg'), 'تم النسخ — copied.', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { $('keytext').select(); });
    } else {
      $('keytext').select();
      document.execCommand('copy');
      done();
    }
  });

  $('save').addEventListener('click', function () {
    var blob = new Blob([$('keytext').value + '\\n'], { type: 'text/plain' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'kayan-licence-key.txt';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  });

  $('readreq').addEventListener('click', function () {
    var code = $('request').value.trim();
    if (!code) { show($('issuemsg'), 'الصق كود الطلب أولًا — paste the request code first.', 'bad'); return; }
    api('/api/request', { code: code }).then(function (payload) {
      $('machine').value = payload.machineId;
      show($('issuemsg'), 'الطلب صالح — valid request\\nmachine: ' + payload.machineId +
        '\\ninstall: ' + (payload.installId || '-') + '\\nversion: ' + (payload.appVersion || '-') +
        '\\nrequested: ' + (payload.requestedAt || '-'), 'ok');
    }).catch(function (error) { show($('issuemsg'), error.message, 'bad'); });
  });

  $('verify').addEventListener('click', function () {
    api('/api/verify', { key: $('inspectkey').value }).then(function (payload) {
      show($('verifymsg'), payload.valid
        ? 'التوقيع صالح — signature valid'
        : 'التوقيع غير صالح — signature INVALID', payload.valid ? 'ok' : 'bad');
      var rows = Object.keys(payload.payload || {}).map(function (name) {
        return '<tr><th>' + esc(name) + '</th><td><code>' +
          esc(JSON.stringify(payload.payload[name])) + '</code></td></tr>';
      }).join('');
      $('verifyout').innerHTML = '<table>' + rows + '</table>';
    }).catch(function (error) {
      $('verifyout').innerHTML = '';
      show($('verifymsg'), error.message, 'bad');
    });
  });

  $('initbtn').addEventListener('click', function () {
    var answer = prompt('اكتب CREATE لتوليد زوج مفاتيح جديد. سيصبح هذا هو مفتاح الإصدار الرسمي.\\nType CREATE to generate a new key pair.');
    if (answer !== 'CREATE') return;
    api('/api/init', {}).then(function (payload) {
      show($('initmsg'), 'تم إنشاء المفتاح. البصمة — fingerprint: ' + payload.fingerprint +
        '\\nاحتفظ بنسخة احتياطية الآن — back it up now.', 'ok');
      $('initmsg').style.display = 'block';
      refresh();
    }).catch(function (error) {
      show($('initmsg'), error.message, 'bad');
      $('initmsg').style.display = 'block';
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (button) {
    button.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (other) {
        other.classList.remove('active');
      });
      button.classList.add('active');
      ['issue', 'register', 'inspect'].forEach(function (name) {
        $('tab-' + name).classList.toggle('hidden', name !== button.getAttribute('data-tab'));
      });
      if (button.getAttribute('data-tab') === 'register') refresh();
    });
  });

  $('type').addEventListener('change', syncType);
  $('licence').addEventListener('change', onLicenceChange);
  $('refresh').addEventListener('click', refresh);

  syncType();
  refresh();
})();
</script>
</body>
</html>`;

function send(response, status, body, type = 'application/json; charset=utf-8') {
  const payload =
    type.startsWith('application/json') ? JSON.stringify(body) : body;
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  response.end(payload);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('The request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('The request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

/**
 * Starts the operator window.
 *
 * `api` is supplied by the caller so this module never owns licensing logic:
 *   state(), createLicence(input), issueKey(input), verifyKey(text),
 *   inspectRequest(code), markUsed(keyId), revokeKey(keyId, reason), initKeyPair()
 */
export async function startGui({
  home,
  port = 0,
  open = true,
  api,
  openBrowser,
  logger = console,
}) {
  const token = randomBytes(24).toString('base64url');

  const routes = {
    'GET /api/state': () => api.state(),
    'POST /api/licence-create': (body) => api.createLicence(body),
    'POST /api/issue': (body) => api.issueKey(body),
    'POST /api/verify': (body) => api.verifyKey(body.key),
    'POST /api/request': (body) => api.inspectRequest(body.code),
    'POST /api/mark-used': (body) => api.markUsed(body.keyId),
    'POST /api/revoke': (body) => api.revokeKey(body.keyId, body.reason),
    'POST /api/init': () => api.initKeyPair(),
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      // Bound to the loopback address, and the Host header must agree, so a
      // page on another origin cannot reach this server by DNS rebinding.
      const host = String(request.headers.host ?? '');
      if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        send(response, 421, { error: 'wrong host' });
        return;
      }

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(response, 200, GUI_HTML, 'text/html; charset=utf-8');
        return;
      }

      const key = `${request.method} ${url.pathname}`;
      const handler = routes[key];
      if (!handler) {
        send(response, 404, { error: 'not found' });
        return;
      }
      if (request.headers['x-kayan-token'] !== token) {
        send(response, 401, { error: 'This window is not the one that was started. Reopen it from the tool.' });
        return;
      }
      const body = request.method === 'POST' ? await readJson(request) : {};
      const result = await handler(body);
      send(response, 200, result ?? { ok: true });
    } catch (error) {
      send(response, 400, { error: error?.message ?? String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/#${token}`;
  logger.log(`KAYAN-GUI-URL=${url}`);
  logger.log(`  home: ${home}`);

  if (open && openBrowser) {
    try {
      await openBrowser(url);
    } catch {
      logger.log('  (could not open a browser automatically; open the address above.)');
    }
  }

  return {
    url,
    port: address.port,
    token,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

export { GUI_HTML };
