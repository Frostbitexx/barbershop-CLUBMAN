const API = "https://sweet-violet-d22b.rafciuglb.workers.dev";

let selectedSlot = null;
let selectedBarber = "any";

const barberInput = document.getElementById("barber");
const barberCards = document.querySelectorAll(".barber-card");
const dateInput = document.getElementById("date");
const slotsDiv = document.getElementById("slots");
const msg = document.getElementById("msg");
const bookButton = document.getElementById("book");

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

async function loadSlots() {
  const date = dateInput.value;
  const barber = barberInput.value || selectedBarber;

  slotsDiv.innerHTML = "";
  selectedSlot = null;

  if (!barber) {
    msg.innerText = "Wybierz barbera.";
    return;
  }

  if (!date) {
    msg.innerText = "Wybierz datę.";
    return;
  }

  msg.innerText = "Pobieranie terminów...";

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
    msg.innerText = "";

    if (slots.length === 0) {
      msg.innerText = "Brak wolnych terminów na wybrany dzień.";
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
    msg.innerText = err.message || "Nie udało się pobrać terminów.";
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
    msg.innerText = "Wybierz barbera.";
    return;
  }

  if (!date) {
    msg.innerText = "Wybierz datę.";
    return;
  }

  if (!selectedSlot) {
    msg.innerText = "Wybierz godzinę.";
    return;
  }

  if (!name || !email || !phone) {
    msg.innerText = "Uzupełnij dane klienta.";
    return;
  }

  bookButton.disabled = true;
  msg.innerText = "Zapisywanie rezerwacji...";

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

    msg.innerText = data.message || "Rezerwacja zapisana.";

    document.getElementById("name").value = "";
    document.getElementById("email").value = "";
    document.getElementById("phone").value = "";

    selectedSlot = null;
    await loadSlots();
  } catch (err) {
    console.error(err);
    msg.innerText = err.message || "Błąd podczas rezerwacji.";
  } finally {
    bookButton.disabled = false;
  }
});