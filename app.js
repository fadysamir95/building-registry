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
const phoneRegex = /^\+?[0-9]{11,}$/;
const floorSelect = document.getElementById("floor");
const successOverlay = document.getElementById("successOverlay");
const refreshBtn = document.getElementById("refreshBtn");

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

  // Populate registered list (grouped)
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
        rented: d.rented ?? null
      };
    }

    groups[key].flats.push(doc.id);
  });

  let index = 1;

  Object.values(groups).forEach(group => {
    const li = document.createElement("li");

    const flats = group.flats.sort().join(" ");

    li.innerHTML = `
      <span class="index">${index}.</span>
      <span class="apt">${flats}</span>
      <span class="name">${group.name}</span>
      <span class="phone" dir="ltr">(${group.phone})</span>
    `;

    list.appendChild(li);
    index++;
    document.getElementById("totalCount").textContent = `إجمالي الشقق: ${totalFlats}`;
    document.getElementById("registeredCount").textContent = `المسجلة: ${registeredFlats}`;
    document.getElementById("remainingCount").textContent = `المتبقية: ${remainingFlats}`;
  });
}

function capitalizeName(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

floorSelect.addEventListener("change", () => {
  apartmentsContainer.innerHTML = "";
  refresh();
});

phoneInput.addEventListener("input", () => {
  let v = phoneInput.value;

  // Remove any char that is not digit or +
  v = v.replace(/[^0-9+]/g, "");

  // Allow + only at the beginning
  if (v.includes("+")) {
    v = "+" + v.replace(/\+/g, "");
  }

  phoneInput.value = v;
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
 * Form submit
 *******************************/
form.addEventListener("submit", async e => {
  e.preventDefault();
  console.log("submit fired");

  const selectedApartments = Array.from(
    apartmentsContainer.querySelectorAll("input[type=checkbox]:checked")
  ).map(cb => cb.value);

  const rawName = document.getElementById("name").value;
  const name = capitalizeName(rawName);
  const phone = document.getElementById("phone").value.trim();
  const rentedValue = document.querySelector('input[name="rented"]:checked')?.value || null;

  // Reset error
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

  for (const apt of selectedApartments) {
    await db.collection("apartments").doc(apt).set({
      name,
      phone,
      rented: rentedValue,   // "yes", "no", or null
      createdAt: new Date()
    });
  }

  apartmentsContainer.querySelectorAll("input").forEach(cb => cb.checked = false);
  successOverlay.classList.remove("hidden");

  refresh();
});

// Initial load
refresh();

// Export
document.getElementById("exportExcel").onclick = async () => {
  if (!window.XLSX) {
    await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
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
        rented: d.rented ?? null
      };
    }

    groups[key].flats.push(doc.id);
  });

  const data = [["شقة", "المالك", "رقم التليفون", "الحالة"]];

  Object.values(groups).forEach(group => {
    const status =
      group.rented === "yes" ? "بها مستأجر" :
      group.rented === "no"  ? "ليس بها مستأجر" :
      "";

    data.push([
      group.flats.sort().join(" "),
      group.name,
      group.phone,
      status
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Owners");

  XLSX.writeFile(wb, "building-owners.xlsx");
};