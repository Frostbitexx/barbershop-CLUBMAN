const API = "https://sweet-violet-d22b.rafciuglb.workers.dev";

let selectedSlot = null;

const dateInput = document.getElementById("date");
const slotsDiv = document.getElementById("slots");
const msg = document.getElementById("msg");

dateInput.addEventListener("change", loadSlots);

async function loadSlots() {
  const date = dateInput.value;

  if (!date) {
    msg.innerText = "Wybierz datę.";
    return;
  }

  try {
    const res = await fetch(`${API}/slots?date=${encodeURIComponent(date)}`);
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
      const div = document.createElement("div");
      div.className = "slot";
      div.innerText = slot;

      div.onclick = () => {
        document.querySelectorAll(".slot").forEach(s => s.classList.remove("selected"));
        div.classList.add("selected");
        selectedSlot = slot;
      };

      slotsDiv.appendChild(div);
    });
  } catch (err) {
    console.error(err);
    slotsDiv.innerHTML = "";
    msg.innerText = "Nie udało się pobrać terminów.";
  }
}

document.getElementById("book").onclick = async () => {
  const date = dateInput.value;
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();

  const serviceElement = document.getElementById("service");
  const service = serviceElement ? serviceElement.value : "Strzyżenie męskie";

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

  try {
    const res = await fetch(`${API}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
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
    await loadSlots();
  } catch (err) {
    console.error(err);
    msg.innerText = err.message || "Błąd podczas rezerwacji.";
  }
};