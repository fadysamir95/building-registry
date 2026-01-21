/*******************************
 * Firebase configuration
 *******************************/
const firebaseConfig = {
  apiKey: "AIzaSyBTZxUskDfzUe5Ym7lsxvTYgOguMQkrGXM",
  authDomain: "building-owners.firebaseapp.com",
  projectId: "building-owners",
  storageBucket: "building-owners.firebasestorage.app",
  messagingSenderId: "712265560524",
  appId: "1:712265560524:web:1cd30c39ea26cbdabfed69"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/*******************************
 * Apartments list (as strings)
 *******************************/
const APARTMENTS = [];
const FLOORS = [0, 1, 2, 3];
const FLATS_PER_FLOOR = 16;

FLOORS.forEach(floor => {
  for (let i = 1; i <= FLATS_PER_FLOOR; i++) {
    const flatNumber = i.toString().padStart(2, "0"); // 01 → 16
    const floorNumber = floor.toString();             // 0 → 3
    APARTMENTS.push(`F${floorNumber}${flatNumber}`);
  }
});

/*******************************
 * DOM elements
 *******************************/
const apartmentsContainer = document.getElementById("apartmentsContainer");
const list = document.getElementById("list");
const form = document.getElementById("form");
const phoneInput = document.getElementById("phone");
const apartmentError = document.getElementById("apartmentError");
const floorSelect = document.getElementById("floor");
const successOverlay = document.getElementById("successOverlay");
const refreshBtn = document.getElementById("refreshBtn");
const loading = document.getElementById("loading");

const phoneRegex = /^\+?[0-9]{11,}$/;

// New form inputs (gates / other)
const gatesAmountWrap = document.getElementById("gatesAmountWrap");
const gatesAmountInput = document.getElementById("gatesAmount");
const otherAmountWrap = document.getElementById("otherAmountWrap");
const otherAmountInput = document.getElementById("otherAmount");

// Edit overlay elements
const editOverlay = document.getElementById("editOverlay");
const editForm = document.getElementById("editForm");
const editFlats = document.getElementById("editFlats");
const editName = document.getElementById("editName");
const editPhone = document.getElementById("editPhone");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editError = document.getElementById("editError");
const editGatesAmountWrap = document.getElementById("editGatesAmountWrap");
const editGatesAmount = document.getElementById("editGatesAmount");
const editOtherAmountWrap = document.getElementById("editOtherAmountWrap");
const editOtherAmount = document.getElementById("editOtherAmount");

/*******************************
 * Helpers
 *******************************/
function capitalizeName(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function toNumberOrZero(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// flats input: "F101, F102" or "F101 F102"
function parseFlatsInput(str) {
  const raw = (str || "")
    .split(/[\s,]+/g)
    .map(x => x.trim())
    .filter(Boolean);

  // normalize uppercase
  const flats = raw.map(x => x.toUpperCase());

  // unique
  return Array.from(new Set(flats));
}

function isValidFlatCode(code) {
  // Must be F + floor 0-3 + two digits 01-16
  if (!/^F[0-3]\d{2}$/.test(code)) return false;
  const floor = Number(code[1]);
  const num = Number(code.slice(2));
  if (!Number.isFinite(floor) || !Number.isFinite(num)) return false;
  return num >= 1 && num <= 16;
}

function statusToArabic(v) {
  if (v === "resident") return "مقيم";
  if (v === "tenant") return "بها مستأجر";
  if (v === "other") return "غير مقيم";

  // fallback لو في داتا قديمة
  if (v === "yes") return "بها مستأجر";
  if (v === "no") return "مقيم";

  return "";
}

function showEditError(msg) {
  editError.textContent = msg;
  editError.style.display = "block";
}

function hideEditError() {
  editError.textContent = "";
  editError.style.display = "none";
}

/*******************************
 * Gates/Other UI toggle
 *******************************/
function bindYesNoAmountToggle(radioName, wrapEl, inputEl) {
  const radios = document.querySelectorAll(`input[name="${radioName}"]`);
  function update() {
    const val = document.querySelector(`input[name="${radioName}"]:checked`)?.value || "no";
    if (val === "yes") {
      wrapEl.classList.remove("hidden");
    } else {
      wrapEl.classList.add("hidden");
      inputEl.value = "";
    }
  }
  radios.forEach(r => r.addEventListener("change", update));
  update();
}

bindYesNoAmountToggle("gatesPaid", gatesAmountWrap, gatesAmountInput);
bindYesNoAmountToggle("otherPaid", otherAmountWrap, otherAmountInput);
bindYesNoAmountToggle("editGatesPaid", editGatesAmountWrap, editGatesAmount);
bindYesNoAmountToggle("editOtherPaid", editOtherAmountWrap, editOtherAmount);

/*******************************
 * Prevent non-digits in phones
 *******************************/
phoneInput.addEventListener("input", () => {
  let v = phoneInput.value;
  v = v.replace(/[^0-9+]/g, "");
  if (v.includes("+")) v = "+" + v.replace(/\+/g, "");
  phoneInput.value = v;
});

editPhone.addEventListener("input", () => {
  let v = editPhone.value;
  v = v.replace(/[^0-9+]/g, "");
  if (v.includes("+")) v = "+" + v.replace(/\+/g, "");
  editPhone.value = v;
});

/*******************************
 * Selection behavior
 *******************************/
floorSelect.addEventListener("change", () => {
  apartmentsContainer.innerHTML = "";
  refresh();
});

apartmentsContainer.addEventListener("change", () => {
  apartmentError.style.display = "none";
});

apartmentsContainer.addEventListener("change", e => {
  const checked = apartmentsContainer.querySelectorAll("input[type=checkbox]:checked");
  if (checked.length > 2) {
    e.target.checked = false;
    alert("يمكنك اختيار شقتين فقط كحد أقصى");
  }
});

refreshBtn.addEventListener("click", () => {
  form.reset();
  apartmentsContainer.querySelectorAll("input").forEach(cb => cb.checked = false);
  successOverlay.classList.add("hidden");
  refresh();
});

/*******************************
 * Groups cache for edit
 *******************************/
let groupsCache = {}; // key -> { name, phone, flats[], rented, gatesPaid, gatesAmount, otherPaid, otherAmount }

/*******************************
 * Refresh UI
 *******************************/
async function refresh() {
  const snap = await db.collection("apartments").get();

  const totalFlats = APARTMENTS.length;
  const registeredFlats = snap.size;
  const remainingFlats = totalFlats - registeredFlats;

  const taken = snap.docs.map(d => d.id);

  // Populate available checkboxes
  apartmentsContainer.innerHTML = "";
  const floor = floorSelect.value;

  if (floor) {
    for (let i = 1; i <= 16; i++) {
      const num = i.toString().padStart(2, "0");
      const apt = `F${floor}${num}`;

      if (!taken.includes(apt)) {
        const label = document.createElement("label");
        label.className = "apt-tile";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = apt;

        const span = document.createElement("span");
        span.textContent = apt;

        label.appendChild(checkbox);
        label.appendChild(span);
        apartmentsContainer.appendChild(label);
      }
    }
  }

  // Group registered list
  list.innerHTML = "";
  const groups = {};

  snap.forEach(doc => {
    const d = doc.data();
    const key = `${d.name}|${d.phone}`;

    if (!groups[key]) {
      groups[key] = {
        name: d.name,
        phone: d.phone,
        flats: [],
        status: d.status ?? d.rented ?? "",
        gatesPaid: d.gatesPaid ?? false,
        gatesAmount: d.gatesAmount ?? 0,
        otherPaid: d.otherPaid ?? false,
        otherAmount: d.otherAmount ?? 0
      };
    }

    groups[key].flats.push(doc.id);
  });

  groupsCache = groups;

  let index = 1;

  Object.entries(groups).forEach(([key, group]) => {
    const li = document.createElement("li");
    const flats = group.flats.sort().join(" ");

    const gatesText = group.gatesPaid ? `بوابات: ${group.gatesAmount || 0}` : "بوابات: -";
    const otherText = group.otherPaid ? `أخرى: ${group.otherAmount || 0}` : "أخرى: -";
    const statusText = statusToArabic(group.status || "");
    const statusClass =
      group.status === "resident" ? "status-green" :
      group.status === "tenant"   ? "status-blue" :
      group.status === "other"    ? "status-gray" :
      "";
    if (!group.gatesPaid) {
      li.classList.add("row-unpaid");
    }

    li.innerHTML = `
      <div>
        <span class="index">${index}.</span>
        <span class="apt">${flats}</span>
        <span class="name">${group.name}</span>
        <span class="phone" dir="ltr">(${group.phone})</span>
        ${statusText ? `<span class="status-badge ${statusClass}">${statusText}</span>` : ""}
        <span class="payments">
          ${gatesText} | ${otherText}
        </span>
      </div>
      <div>
        <!-- <button class="edit-btn" data-key="${encodeURIComponent(key)}" type="button">تعديل</button> -->
      </div>
    `;

    list.appendChild(li);
    index++;
  });

  document.getElementById("totalCount").textContent = `إجمالي الشقق: ${totalFlats}`;
  document.getElementById("registeredCount").textContent = `المسجلة: ${registeredFlats}`;
  document.getElementById("remainingCount").textContent = `المتبقية: ${remainingFlats}`;
}

/*******************************
 * Open edit modal
 *******************************/
function openEdit(key) {
  hideEditError();

  const group = groupsCache[key];
  if (!group) {
    alert("لم يتم العثور على البيانات");
    return;
  }

  // Fill fields
  editFlats.value = group.flats.sort().join(" ");
  editName.value = group.name || "";
  editPhone.value = group.phone || "";

  // status
  const statusVal = group.status ?? "";
  const statusRadios = document.querySelectorAll('input[name="editStatus"]');
  statusRadios.forEach(r => {
    r.checked = (r.value === (statusVal || ""));
  });

  // gates
  const gatesPaidVal = group.gatesPaid ? "yes" : "no";
  document.querySelectorAll('input[name="editGatesPaid"]').forEach(r => {
    r.checked = (r.value === gatesPaidVal);
  });
  editGatesAmount.value = group.gatesPaid ? String(group.gatesAmount ?? "") : "";

  // other
  const otherPaidVal = group.otherPaid ? "yes" : "no";
  document.querySelectorAll('input[name="editOtherPaid"]').forEach(r => {
    r.checked = (r.value === otherPaidVal);
  });
  editOtherAmount.value = group.otherPaid ? String(group.otherAmount ?? "") : "";

  // re-run toggles
  const gatesEvent = new Event("change");
  document.querySelector('input[name="editGatesPaid"]:checked')?.dispatchEvent(gatesEvent);
  document.querySelector('input[name="editOtherPaid"]:checked')?.dispatchEvent(gatesEvent);

  // store current editing key
  editForm.dataset.key = key;

  editOverlay.classList.remove("hidden");
}

function closeEdit() {
  editOverlay.classList.add("hidden");
  editForm.reset();
  delete editForm.dataset.key;
  hideEditError();
}

cancelEditBtn.addEventListener("click", closeEdit);

/*******************************
 * Edit button (delegation)
 *******************************/
list.addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-btn");
  if (!btn) return;
  const key = decodeURIComponent(btn.dataset.key || "");
  openEdit(key);
});

/*******************************
 * Form submit (new registration)
 *******************************/
form.addEventListener("submit", async e => {
  e.preventDefault();

  const selectedApartments = Array.from(
    apartmentsContainer.querySelectorAll("input[type=checkbox]:checked")
  ).map(cb => cb.value);

  const rawName = document.getElementById("name").value;
  const name = capitalizeName(rawName);
  const phone = document.getElementById("phone").value.trim();
  const statusValue = document.querySelector('input[name="status"]:checked')?.value || "";

  // NEW: gates/other
  const gatesPaid = (document.querySelector('input[name="gatesPaid"]:checked')?.value || "no") === "yes";
  const gatesAmount = gatesPaid ? toNumberOrZero(gatesAmountInput.value) : 0;

  const otherPaid = (document.querySelector('input[name="otherPaid"]:checked')?.value || "no") === "yes";
  const otherAmount = otherPaid ? toNumberOrZero(otherAmountInput.value) : 0;

  apartmentError.style.display = "none";

  if (selectedApartments.length === 0) {
    apartmentError.textContent = "من فضلك اختر شقة واحدة على الأقل";
    apartmentError.style.display = "block";
    return;
  }

  if (!name || !phone) return;

  if (!phoneRegex.test(phone)) {
    alert("رقم التليفون يجب أن يكون أرقام فقط، ويمكن أن يبدأ بـ +، ولا يقل عن 11 رقم");
    return;
  }

  // Batch write (safer)
  const batch = db.batch();
  selectedApartments.forEach(apt => {
    const ref = db.collection("apartments").doc(apt);
    batch.set(ref, {
      name,
      phone,
      status: statusValue || null,
      gatesPaid,
      gatesAmount,
      otherPaid,
      otherAmount,
      createdAt: new Date()
    });
  });

  await batch.commit();

  apartmentsContainer.querySelectorAll("input").forEach(cb => cb.checked = false);
  successOverlay.classList.remove("hidden");

  refresh();
});

/*******************************
 * Edit submit
 *******************************/
editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideEditError();

  const key = editForm.dataset.key;
  const current = groupsCache[key];
  if (!current) {
    showEditError("لم يتم العثور على بيانات المالك الحالي.");
    return;
  }

  const newName = capitalizeName(editName.value || "");
  const newPhone = (editPhone.value || "").trim();
  const flats = parseFlatsInput(editFlats.value);

  if (!newName || !newPhone) {
    showEditError("من فضلك أدخل الاسم ورقم التليفون.");
    return;
  }

  if (!phoneRegex.test(newPhone)) {
    showEditError("رقم التليفون غير صحيح (لا يقل عن 11 رقم ويمكن أن يبدأ بـ +).");
    return;
  }

  if (flats.length === 0) {
    showEditError("من فضلك أدخل شقة واحدة على الأقل.");
    return;
  }

  if (flats.length > 2) {
    showEditError("الحد الأقصى للتعديل شقتين فقط.");
    return;
  }

  for (const f of flats) {
    if (!isValidFlatCode(f)) {
      showEditError(`رقم الشقة غير صحيح: ${f} (مثال صحيح: F101)`);
      return;
    }
  }

  const statusVal = document.querySelector('input[name="editStatus"]:checked')?.value ?? "";
  const statusValue = statusVal ? statusVal : null;

  const gatesPaid = (document.querySelector('input[name="editGatesPaid"]:checked')?.value || "no") === "yes";
  const gatesAmount = gatesPaid ? toNumberOrZero(editGatesAmount.value) : 0;

  const otherPaid = (document.querySelector('input[name="editOtherPaid"]:checked')?.value || "no") === "yes";
  const otherAmount = otherPaid ? toNumberOrZero(editOtherAmount.value) : 0;

  // Check collisions: new flats can't be taken by someone else
  const snap = await db.collection("apartments").get();
  const takenByOthers = new Set();
  snap.forEach(doc => {
    const id = doc.id;
    const d = doc.data();
    const k = `${d.name}|${d.phone}`;
    if (k !== key) takenByOthers.add(id);
  });

  for (const f of flats) {
    if (takenByOthers.has(f)) {
      showEditError(`الشقة ${f} مسجلة بالفعل لمالك آخر.`);
      return;
    }
  }

  const currentFlats = new Set((current.flats || []).map(x => x.toUpperCase()));
  const newFlats = new Set(flats);

  const toDelete = Array.from(currentFlats).filter(f => !newFlats.has(f));
  const toAdd = Array.from(newFlats).filter(f => !currentFlats.has(f));
  const toUpdate = Array.from(newFlats).filter(f => currentFlats.has(f));

  const payload = {
    name: newName,
    phone: newPhone,
    status: statusValue,
    gatesPaid,
    gatesAmount,
    otherPaid,
    otherAmount,
    updatedAt: new Date()
  };

  const batch = db.batch();

  // delete removed flats
  toDelete.forEach(f => {
    batch.delete(db.collection("apartments").doc(f));
  });

  // add new flats
  toAdd.forEach(f => {
    batch.set(db.collection("apartments").doc(f), {
      ...payload,
      createdAt: new Date()
    });
  });

  // update existing flats (rename/phone/amounts…)
  toUpdate.forEach(f => {
    batch.set(db.collection("apartments").doc(f), payload, { merge: true });
  });

  await batch.commit();

  closeEdit();
  refresh();
});

/*******************************
 * Export
 *******************************/
document.getElementById("exportExcel").onclick = async () => {
  if (!window.XLSX) {
    await import("https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js");
  }

  loading.classList.remove("hidden");
  const snap = await db.collection("apartments").get();
  loading.classList.add("hidden");

  const groups = {};
  snap.forEach(doc => {
    const d = doc.data();
    const key = `${d.name}|${d.phone}`;

    if (!groups[key]) {
      groups[key] = {
        name: d.name,
        phone: d.phone,
        flats: [],
        status: d.status ?? d.rented ?? null,
        gatesPaid: d.gatesPaid ?? false,
        gatesAmount: d.gatesAmount ?? 0,
        otherPaid: d.otherPaid ?? false,
        otherAmount: d.otherAmount ?? 0
      };
    }

    groups[key].flats.push(doc.id);
  });

  const data = [["شقة", "المالك", "رقم التليفون", "الحالة", "البوابات", "اخرى", "الإجمالي"]];

  let sumGates = 0;
  let sumOther = 0;
  const rowsMeta = [];

  Object.values(groups).forEach(group => {
    const statusText =
      group.status === "resident" ? "مقيم" :
      group.status === "tenant"   ? "بها مستأجر" :
      group.status === "other"    ? "غير مقيم" :
      "";

    const gatesCol = group.gatesPaid ? String(group.gatesAmount || "") : "";
    const otherCol = group.otherPaid ? String(group.otherAmount || "") : "";
    const totalPaid = (Number(group.gatesAmount || 0) + Number(group.otherAmount || 0)) || "";

    sumGates += Number(group.gatesAmount || 0);
    sumOther += Number(group.otherAmount || 0);

    data.push([
      group.flats.sort().join(" "),
      group.name,
      group.phone,
      statusText,
      gatesCol,
      otherCol,
      totalPaid
    ]);

    rowsMeta.push({
      gatesPaid: group.gatesPaid
    });
  });

  data.push(["", "", "", "الإجمالي", sumGates, sumOther, (sumGates + sumOther)]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      ws[addr].s = ws[addr].s || {};
      ws[addr].s.alignment = { horizontal: "center", vertical: "center" };
    }
  }

  rowsMeta.forEach((meta, i) => {
    if (meta.gatesPaid === false) {
      const rowIndex = i + 1;

      for (let C = 0; C <= 6; C++) {
        const addr = XLSX.utils.encode_cell({ r: rowIndex, c: C });
        if (!ws[addr]) continue;

        ws[addr].s = ws[addr].s || {};
        ws[addr].s.fill = {
          fgColor: { rgb: "FDECEA" }
        };
        ws[addr].s.font = {
          color: { rgb: "C0392B" },
          bold: true
        };
        ws[addr].s.alignment = { horizontal: "center", vertical: "center" };
      }
    }
  });

  // set column widths a bit nicer
  ws["!cols"] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Owners");

  XLSX.writeFile(wb, "Building F622 Owners.xlsx");
};

/*******************************
 * Initial load
 *******************************/
refresh();
