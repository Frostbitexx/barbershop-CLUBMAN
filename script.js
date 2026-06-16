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
const bookingFormView = document.getElementById("bookingFormView");
const bookingSuccess = document.getElementById("bookingSuccess");
const bookingCard = document.getElementById("bookingCard");
const successCard = document.getElementById("successCard");

const successBarber = document.getElementById("successBarber");
const successService = document.getElementById("successService");
const successDate = document.getElementById("successDate");
const successTime = document.getElementById("successTime");

const successCalendarLink = document.getElementById("successCalendarLink");
const successRescheduleLink = document.getElementById("successRescheduleLink");
const successCancelLink = document.getElementById("successCancelLink");

const backToBooking = document.getElementById("backToBooking");

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
  if (!bookingLoader || !bookingLoaderText) return;

  bookingLoaderText.innerText = text;
  bookingLoader.classList.remove("hidden");
  bookingLoader.setAttribute("aria-hidden", "false");
}

function hideLoader() {
  if (!bookingLoader) return;

  bookingLoader.classList.add("hidden");
  bookingLoader.setAttribute("aria-hidden", "true");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPolishDate(dateStr) {
  const [year, month, day] = String(dateStr).split("-");

  if (!year || !month || !day) {
    return dateStr;
  }

  return `${day}.${month}.${year}`;
}

function showBookingSuccess(data, bookingSummary) {
  successBarber.innerText = bookingSummary.barberName || "-";
  successService.innerText = bookingSummary.service || "-";
  successDate.innerText = formatDateForDisplay(bookingSummary.date);
  successTime.innerText = bookingSummary.time || "-";

  successCalendarLink.href = bookingSummary.calendarLink || "#";
  successRescheduleLink.href = bookingSummary.rescheduleLink || "#";
  successCancelLink.href = bookingSummary.cancelLink || "#";

  bookingCard.classList.add("hidden");
  successCard.classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
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
function formatDateForDisplay(date) {
  if (!date) return "-";

  const [year, month, day] = date.split("-");

  if (!year || !month || !day) return date;

  return `${day}.${month}.${year}`;
}

function showSuccessScreen(payload, data) {
  successBarber.innerText = data.barberName || payload.barber || "-";
  successService.innerText = payload.service || "-";
  successDate.innerText = formatDateForDisplay(payload.date);
  successTime.innerText = payload.time || "-";

  successCalendarLink.href = data.calendarLink || "#";
  successRescheduleLink.href = data.rescheduleLink || "#";
  successCancelLink.href = data.cancelLink || "#";

  bookingCard.classList.add("hidden");
  successCard.classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

backToBooking.addEventListener("click", () => {
  successCard.classList.add("hidden");
  bookingCard.classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
});

bookButton.addEventListener("click", async () => {
  const barber = barberInput.value || selectedBarber;
  const date = dateInput.value;
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const service = document.getElementById("service").value;
  const bookedSlot = selectedSlot;

  if (!barber) {
    setMessage("Wybierz barbera.", "error");
    return;
  }

  if (!date) {
    setMessage("Wybierz datę.", "error");
    return;
  }

  if (!bookedSlot) {
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
const bookingPayload = {
  barber,
  date,
  time: selectedSlot,
  name,
  email,
  phone,
  service
};
  try {
    const res = await fetch(`${API}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
body: JSON.stringify(bookingPayload)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Błąd ${res.status}`);
    }

const bookingSummary = {
  name,
  email,
  phone,
  service,
  date,
  time: bookedSlot,
  barberName: data.booking?.barberName || data.barberName || "-",

  calendarLink:
    data.calendarLink ||
    data.booking?.calendarLink ||
    "#",

  rescheduleLink:
    data.rescheduleLink ||
    data.booking?.rescheduleLink ||
    "#",

  cancelLink:
    data.cancelLink ||
    data.booking?.cancelLink ||
    "#"
};

    document.getElementById("name").value = "";
    document.getElementById("email").value = "";
    document.getElementById("phone").value = "";

    selectedSlot = null;
    await loadSlots();
    showBookingSuccess(data, bookingSummary);
  } catch (err) {
    console.error(err);
    setMessage(err.message || "Błąd podczas rezerwacji.", "error");
  } finally {
    hideLoader();
    bookButton.disabled = false;
    bookButton.innerText = "Potwierdź rezerwację";
  }
});
