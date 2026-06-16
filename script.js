const API = "https://sweet-violet-d22b.rafciuglb.workers.dev";

let selectedSlot = null;
let selectedBarber = "any";

const barberInput = document.getElementById("barber");
const barberCards = document.querySelectorAll(".barber-card");
const dateInput = document.getElementById("date");
const slotsDiv = document.getElementById("slots");
const msg = document.getElementById("msg");
const bookButton = document.getElementById("book");
const bookingLoader = document.getElementById("bookingLoader");
const bookingLoaderText = document.getElementById("bookingLoaderText");

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
dateInput.min = `${yyyy}-${mm}-${dd}`;

barberCards.forEach(card => {
  card.addEventListener("click", () => {
    barberCards.forEach(item => item.classList.remove("selected"));
    card.classList.add("selected");

    selectedBarber = card.dataset.barber;
    barberInput.value = selectedBarber;

    loadSlots();
  });
});

dateInput.addEventListener("change", loadSlots);

function setMessage(text = "", type = "") {
  msg.innerText = text;
  msg.classList.remove("success", "error");

  if (type) {
    msg.classList.add(type);
  }
}

function showLoader(text = "Zapisywanie rezerwacji...") {
  bookingLoaderText.innerText = text;
  bookingLoader.classList.remove("hidden");
  bookingLoader.setAttribute("aria-hidden", "false");
}

function hideLoader() {
  bookingLoader.classList.add("hidden");
  bookingLoader.setAttribute("aria-hidden", "true");
}

async function loadSlots() {
  const date = dateInput.value;
  const barber = barberInput.value || selectedBarber;

  slotsDiv.innerHTML = "";
  selectedSlot = null;

  if (!barber) {
    setMessage("Wybierz barbera.", "error");
    return;
  }

  if (!date) {
    setMessage("Wybierz datę.", "error");
    return;
  }

 setMessage("Pobieranie terminów...");

  try {
    const res = await fetch(
      `${API}/slots?date=${encodeURIComponent(date)}&barber=${encodeURIComponent(barber)}`
    );

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Błąd ${res.status}`);
    }

    const slots = data.availableSlots || [];

    slotsDiv.innerHTML = "";
    selectedSlot = null;
    setMessage("");

    if (slots.length === 0) {
      setMessage("Brak wolnych terminów na wybrany dzień.");
      return;
    }

    slots.forEach(slot => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot";
      button.innerText = slot;

      button.addEventListener("click", () => {
        document.querySelectorAll(".slot").forEach(s => s.classList.remove("selected"));
        button.classList.add("selected");
        selectedSlot = slot;
      });

      slotsDiv.appendChild(button);
    });
  } catch (err) {
    console.error(err);
    slotsDiv.innerHTML = "";
    setMessage(err.message || "Nie udało się pobrać terminów.", "error");
  }
}

bookButton.addEventListener("click", async () => {
  const barber = barberInput.value || selectedBarber;
  const date = dateInput.value;
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const service = document.getElementById("service").value;

  if (!barber) {
    setMessage("Wybierz barbera.", "error");
    return;
  }

  if (!date) {
    setMessage("Wybierz datę.", "error");
    return;
  }

  if (!selectedSlot) {
    setMessage("Wybierz godzinę.", "error");
    return;
  }

  if (!name || !email || !phone) {
    setMessage("Uzupełnij dane klienta.", "error");
    return;
  }

  bookButton.disabled = true;
  bookButton.innerText = "Trwa zapisywanie...";
  showLoader("Zapisywanie rezerwacji...");

  try {
    const res = await fetch(`${API}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        barber,
        date,
        time: selectedSlot,
        name,
        email,
        phone,
        service
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Błąd ${res.status}`);
    }

    setMessage(data.message || "Rezerwacja zapisana.", "success");

    document.getElementById("name").value = "";
    document.getElementById("email").value = "";
    document.getElementById("phone").value = "";

    selectedSlot = null;
    await loadSlots();
  } catch (err) {
    console.error(err);
    setMessage(err.message || "Błąd podczas rezerwacji.", "error");
  } finally {
    hideLoader();
    bookButton.disabled = false;
    bookButton.innerText = "Potwierdź rezerwację";
  }
});