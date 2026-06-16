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

function showBookingSuccess(data, booking) {
  const links = data.links || {};

  bookingFormView.classList.add("hidden");

  bookingSuccess.innerHTML = `
    <div class="booking-success-icon">✓</div>

    <h2>Rezerwacja potwierdzona</h2>

    <p class="booking-success-lead">
      Dzięki ${escapeHtml(booking.name)}! Twoja wizyta została zapisana. Potwierdzenie wysłaliśmy też na e-mail.
    </p>

    <div class="booking-summary-box">
      <div class="booking-summary-title">Szczegóły rezerwacji</div>

      <div class="booking-summary-row">
        <span>Barber</span>
        <strong>${escapeHtml(booking.barberName || "-")}</strong>
      </div>

      <div class="booking-summary-row">
        <span>Usługa</span>
        <strong>${escapeHtml(booking.service || "-")}</strong>
      </div>

      <div class="booking-summary-row">
        <span>Data</span>
        <strong>${escapeHtml(formatPolishDate(booking.date))}</strong>
      </div>

      <div class="booking-summary-row">
        <span>Godzina</span>
        <strong>${escapeHtml(booking.time || "-")}</strong>
      </div>
    </div>

    <div class="booking-success-actions">
      ${links.calendarLink ? `
        <a class="success-action primary" href="${escapeHtml(links.calendarLink)}" target="_blank" rel="noopener">
          Dodaj do kalendarza
        </a>
      ` : ""}

      ${links.rescheduleLink ? `
        <a class="success-action" href="${escapeHtml(links.rescheduleLink)}" target="_blank" rel="noopener">
          Zmień termin
        </a>
      ` : ""}

      ${links.cancelLink ? `
        <a class="success-action danger" href="${escapeHtml(links.cancelLink)}" target="_blank" rel="noopener">
          Odwołaj wizytę
        </a>
      ` : ""}
    </div>

    ${!links.rescheduleLink || !links.cancelLink ? `
      <p class="booking-success-note">
        Link do zmiany lub odwołania wizyty znajdziesz również w mailu potwierdzającym.
      </p>
    ` : ""}

    <button type="button" id="backToBooking" class="back-to-booking-btn">
      Wróć do formularza
    </button>
  `;

  bookingSuccess.classList.remove("hidden");

  bookingSuccess.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  const backButton = document.getElementById("backToBooking");

  if (backButton) {
    backButton.addEventListener("click", () => {
      bookingSuccess.classList.add("hidden");
      bookingSuccess.innerHTML = "";
      bookingFormView.classList.remove("hidden");
      setMessage("");
      selectedSlot = null;
      loadSlots();

      document.querySelector(".booking-card").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }
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

  try {
    const res = await fetch(`${API}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        barber,
        date,
        time: bookedSlot,
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

    const bookingSummary = {
      name,
      email,
      phone,
      service,
      date,
      time: bookedSlot,
      barberName: data.booking?.barberName || data.barberName || "-"
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
