const OPEN_HOUR = 8;
const CLOSE_HOUR = 21;
const APPOINTMENT_MINUTES = 60;
const CANCEL_LIMIT_MINUTES = 60;

const BARBERS = {
  barber1: {
    id: "barber1",
    name: "Barber 1",
    calendarIdEnv: "GOOGLE_CALENDAR_ID_BARBER1"
  },
  barber2: {
    id: "barber2",
    name: "Barber 2",
    calendarIdEnv: "GOOGLE_CALENDAR_ID_BARBER2"
  },
  barber3: {
    id: "barber3",
    name: "Barber 3",
    calendarIdEnv: "GOOGLE_CALENDAR_ID_BARBER3"
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (pathname === "/") {
      return jsonResponse({
        success: true,
        message: "Worker działa",
        barbers: getPublicBarbers()
      });
    }

    if (pathname === "/barbers" && request.method === "GET") {
      return jsonResponse({
        success: true,
        barbers: getPublicBarbers()
      });
    }

    if (pathname === "/slots" && request.method === "GET") {
      try {
        const date = url.searchParams.get("date");
        const barber = url.searchParams.get("barber");

        if (!date || !barber) {
          return jsonResponse({
            success: false,
            message: "Brak daty lub wybranego barbera"
          }, 400);
        }

        if (barber === "any") {
          const { uniqueSlots } = await getAvailableSlotsForAnyBarber(date, env);

          return jsonResponse({
            success: true,
            availableSlots: uniqueSlots
          });
        }

        const availableSlots = await getAvailableSlots(date, barber, env);

        return jsonResponse({
          success: true,
          availableSlots
        });
      } catch (err) {
        return jsonResponse({
          success: false,
          message: err.message
        }, 500);
      }
    }

    if (pathname === "/book" && request.method === "POST") {
      try {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim();
        const phone = String(body.phone || "").trim();
        const service = String(body.service || "Strzyżenie męskie").trim();
        const date = String(body.date || "").trim();
        const time = String(body.time || "").trim();
        const barber = String(body.barber || "").trim();

        if (!name || !email || !phone || !date || !time || !barber) {
          return jsonResponse({
            success: false,
            message: "Brakuje danych"
          }, 400);
        }

        validateDate(date);
        validateTime(time);

        const resolvedBarber = await resolveBarberForBooking(date, time, barber, env);

        const payload = {
          name,
          email,
          phone,
          service,
          date,
          time,
          barber: resolvedBarber.barberId,
          barberName: resolvedBarber.barberName,
          requestedBarber: barber
        };

        const event = await createCalendarEvent(payload, env);
        const links = await createBookingLinks(payload, event, env);

        await sendCustomerConfirmationEmail(payload, event, env);
        await sendOwnerNotificationEmail(payload, env);

        return jsonResponse({
          success: true,
          message:
            barber === "any"
              ? `Rezerwacja potwierdzona. Przydzielony barber: ${resolvedBarber.barberName}`
              : "Rezerwacja potwierdzona",
          eventId: event.id,
          barber: resolvedBarber.barberId,
          barberName: resolvedBarber.barberName,
          booking: {
            name,
            email,
            phone,
            service,
            date,
            time,
            barber: resolvedBarber.barberId,
            barberName: resolvedBarber.barberName
          },
          links
        });
      } catch (err) {
        const message = err.message || "Wystąpił błąd";

        const status =
          message.includes("zajęty") || message.includes("niedostępny")
            ? 409
            : 500;

        return jsonResponse({
          success: false,
          message
        }, status);
      }
    }

    if (pathname === "/cancel" && request.method === "GET") {
      try {
        const token = url.searchParams.get("token");

        if (!token) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Brak linku anulowania</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Link jest nieprawidłowy albo niepełny.
            </p>
          `, 400);
        }

        const tokenData = await verifyCancelToken(token, env);
        const data = await getCurrentBookingData(tokenData, env);
        const cancelState = getCancellationState(data.start);

        if (cancelState.status === "past") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie można anulować wizyty</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Termin już minął albo właśnie trwa.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              W razie potrzeby skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 400);
        }

        if (cancelState.status === "too_late") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Za późno na anulowanie online</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Wizytę można odwołać online najpóźniej 1 godzinę przed terminem.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 403);
        }

        return htmlResponse(`
          <h1 style="margin:0 0 18px 0;font-size:28px;color:#f4f1ea;">Potwierdź odwołanie wizyty</h1>

          <div style="background:#111114;border:1px solid #2b2b31;border-radius:16px;padding:20px;margin:0 0 22px 0;">
            <div style="margin:0 0 10px 0;color:#9f978c;font-size:13px;letter-spacing:1px;text-transform:uppercase;">
              Szczegóły rezerwacji
            </div>

            <p style="margin:0 0 10px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              <strong style="color:#ffffff;">Barber:</strong> ${escapeHtml(data.barberName || "-")}
            </p>

            <p style="margin:0 0 10px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              <strong style="color:#ffffff;">Usługa:</strong> ${escapeHtml(data.service || "-")}
            </p>

            <p style="margin:0 0 10px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              <strong style="color:#ffffff;">Data:</strong> ${escapeHtml(formatPolishDate(data.date))}
            </p>

            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              <strong style="color:#ffffff;">Godzina:</strong> ${escapeHtml(data.time)}
            </p>
          </div>

          <p style="margin:0 0 20px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Możesz odwołać wizytę albo samodzielnie wybrać nowy termin. Bez telefonicznego ping-ponga.
          </p>

          <div style="display:flex;gap:12px;flex-wrap:wrap;margin:0 0 16px 0;">
            <form method="POST" action="/cancel" style="margin:0;">
              <input type="hidden" name="token" value="${escapeHtml(token)}" />
              <button type="submit" style="appearance:none;border:none;cursor:pointer;display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#17130f;text-decoration:none;border-radius:12px;background:linear-gradient(135deg,#c9a66b,#e0be86);">
                Potwierdź odwołanie
              </button>
            </form>

            <a href="/reschedule?token=${encodeURIComponent(token)}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#f4f1ea;text-decoration:none;border-radius:12px;background:#2a2a30;border:1px solid #3a3a42;">
              Zmień termin
            </a>
          </div>

          <p style="margin:0;color:#a9a39a;font-size:14px;line-height:1.7;">
            Jeśli to pomyłka, po prostu zamknij tę stronę.
          </p>
        `, 200);
      } catch (err) {
        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie udało się otworzyć anulowania</h1>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            ${escapeHtml(err.message)}
          </p>
        `, 400);
      }
    }

    if (pathname === "/cancel" && request.method === "POST") {
      try {
        const contentType = request.headers.get("content-type") || "";
        let token = "";

        if (
          contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data")
        ) {
          const formData = await request.formData();
          token = String(formData.get("token") || "").trim();
        } else if (contentType.includes("application/json")) {
          const body = await request.json();
          token = String(body.token || "").trim();
        }

        if (!token) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Brak tokena anulowania</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Nie udało się potwierdzić anulowania.
            </p>
          `, 400);
        }

        const tokenData = await verifyCancelToken(token, env);
        const data = await getCurrentBookingData(tokenData, env);
        const cancelState = getCancellationState(data.start);

        if (cancelState.status === "past") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie można anulować wizyty</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Termin już minął albo właśnie trwa.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              W razie potrzeby skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 400);
        }

        if (cancelState.status === "too_late") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Za późno na anulowanie online</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Do wizyty zostało mniej niż 1 godzina.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 403);
        }

        await deleteCalendarEvent(data.eventId, data.barber, env);

        const cancelPayload = {
          name: data.name || "",
          email: data.email || "",
          phone: data.phone || "",
          service: data.service || "",
          date: data.date || "",
          time: data.time || "",
          barber: data.barber || "",
          barberName: data.barberName || ""
        };

        if (cancelPayload.email) {
          await sendCustomerCancellationEmail(cancelPayload, env);
        }

        await sendOwnerCancellationNotificationEmail(cancelPayload, env);

        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Wizyta została odwołana</h1>
          <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Barber:
            <strong style="color:#ffffff;">${escapeHtml(data.barberName || "-")}</strong>
          </p>
          <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Termin:
            <strong style="color:#ffffff;">${escapeHtml(formatPolishDate(data.date))} ${escapeHtml(data.time)}</strong>
          </p>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Potwierdzenie anulowania zostało wysłane mailowo.
          </p>
        `, 200);
      } catch (err) {
        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie udało się odwołać wizyty</h1>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            ${escapeHtml(err.message)}
          </p>
        `, 400);
      }
    }

    if (pathname === "/reschedule" && request.method === "GET") {
      try {
        const token = url.searchParams.get("token");

        if (!token) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Brak linku zmiany terminu</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Link jest nieprawidłowy albo niepełny.
            </p>
          `, 400);
        }

        const tokenData = await verifyCancelToken(token, env);
        const data = await getCurrentBookingData(tokenData, env);
        const cancelState = getCancellationState(data.start);

        if (cancelState.status === "past") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie można zmienić terminu</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Termin już minął albo właśnie trwa.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              W razie potrzeby skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 400);
        }

        if (cancelState.status === "too_late") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Za późno na zmianę online</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Wizytę można zmienić online najpóźniej 1 godzinę przed terminem.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 403);
        }

        return htmlResponse(renderReschedulePage(data, token, env), 200);
      } catch (err) {
        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie udało się otworzyć zmiany terminu</h1>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            ${escapeHtml(err.message)}
          </p>
        `, 400);
      }
    }

    if (pathname === "/reschedule" && request.method === "POST") {
      try {
        const contentType = request.headers.get("content-type") || "";
        let token = "";
        let newDate = "";
        let newTime = "";

        if (
          contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data")
        ) {
          const formData = await request.formData();
          token = String(formData.get("token") || "").trim();
          newDate = String(formData.get("date") || "").trim();
          newTime = String(formData.get("time") || "").trim();
        } else if (contentType.includes("application/json")) {
          const body = await request.json();
          token = String(body.token || "").trim();
          newDate = String(body.date || "").trim();
          newTime = String(body.time || "").trim();
        }

        if (!token || !newDate || !newTime) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Brakuje danych</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Wybierz nową datę i godzinę.
            </p>
          `, 400);
        }

        validateDate(newDate);
        validateTime(newTime);

        const tokenData = await verifyCancelToken(token, env);
        const data = await getCurrentBookingData(tokenData, env);
        const cancelState = getCancellationState(data.start);

        if (cancelState.status === "past") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie można zmienić terminu</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Termin już minął albo właśnie trwa.
            </p>
          `, 400);
        }

        if (cancelState.status === "too_late") {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Za późno na zmianę online</h1>
            <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Do wizyty zostało mniej niż 1 godzina.
            </p>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Skontaktuj się telefonicznie:
              <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
            </p>
          `, 403);
        }

        if (newDate === data.date && newTime === data.time) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">To jest obecny termin</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Wybierz inną godzinę albo inną datę.
            </p>
          `, 400);
        }

        const availableSlots = await getAvailableSlots(newDate, data.barber, env);

        if (!availableSlots.includes(newTime)) {
          return htmlResponse(`
            <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Termin jest niedostępny</h1>
            <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
              Ktoś był szybszy albo ta godzina jest już zajęta. Wróć i wybierz inny slot.
            </p>
          `, 409);
        }

        const previousPayload = {
          name: data.name || "",
          email: data.email || "",
          phone: data.phone || "",
          service: data.service || "",
          date: data.date || "",
          time: data.time || "",
          barber: data.barber || "",
          barberName: data.barberName || ""
        };

        const newPayload = {
          ...previousPayload,
          date: newDate,
          time: newTime,
          requestedBarber: data.barber
        };

        const updatedEvent = await updateCalendarEvent(data.eventId, newPayload, env);

        if (newPayload.email) {
          await sendCustomerRescheduleEmail(newPayload, previousPayload, updatedEvent, env);
        }

        await sendOwnerRescheduleNotificationEmail(newPayload, previousPayload, env);

        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Termin został zmieniony</h1>
          <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Stary termin:
            <strong style="color:#ffffff;">${escapeHtml(formatPolishDate(previousPayload.date))} ${escapeHtml(previousPayload.time)}</strong>
          </p>
          <p style="margin:0 0 12px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Nowy termin:
            <strong style="color:#ffffff;">${escapeHtml(formatPolishDate(newPayload.date))} ${escapeHtml(newPayload.time)}</strong>
          </p>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            Potwierdzenie zmiany zostało wysłane mailowo.
          </p>
        `, 200);
      } catch (err) {
        return htmlResponse(`
          <h1 style="margin:0 0 14px 0;font-size:28px;color:#f4f1ea;">Nie udało się zmienić terminu</h1>
          <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
            ${escapeHtml(err.message)}
          </p>
        `, 400);
      }
    }

    return jsonResponse({
      success: false,
      message: "Not found"
    }, 404);
  }
};

function getPublicBarbers() {
  return [
    { id: "any", name: "Dowolny barber" },
    ...Object.values(BARBERS).map(barber => ({
      id: barber.id,
      name: barber.name
    }))
  ];
}

function getBarberConfig(barberId, env) {
  const barber = BARBERS[barberId];

  if (!barber) {
    throw new Error("Nieprawidłowy barber.");
  }

  const calendarId = env[barber.calendarIdEnv];

  if (!calendarId) {
    throw new Error(`Brak kalendarza dla ${barber.name}. Ustaw ${barber.calendarIdEnv}.`);
  }

  return {
    ...barber,
    calendarId
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(`
    <!DOCTYPE html>
    <html lang="pl">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Anulowanie wizyty</title>
      </head>
      <body style="margin:0;padding:40px 20px;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
        <div style="max-width:640px;margin:0 auto;background:#18181b;border:1px solid #2c2c31;border-radius:20px;padding:32px;">
          ${html}
        </div>
      </body>
    </html>
  `, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      ...corsHeaders()
    }
  });
}

async function getAvailableSlotsForAnyBarber(date, env) {
  validateDate(date);

  const entries = await Promise.all(
    Object.values(BARBERS).map(async barber => {
      const slots = await getAvailableSlots(date, barber.id, env);
      return { barberId: barber.id, slots };
    })
  );

  const slotMap = new Map();

  for (const entry of entries) {
    for (const slot of entry.slots) {
      if (!slotMap.has(slot)) {
        slotMap.set(slot, []);
      }
      slotMap.get(slot).push(entry.barberId);
    }
  }

  const uniqueSlots = Array.from(slotMap.keys()).sort((a, b) => {
    return timeToMinutes(a) - timeToMinutes(b);
  });

  return {
    uniqueSlots,
    slotMap
  };
}

async function resolveBarberForBooking(date, time, barber, env) {
  if (barber !== "any") {
    const barberConfig = getBarberConfig(barber, env);
    const availableSlots = await getAvailableSlots(date, barber, env);

    if (!availableSlots.includes(time)) {
      throw new Error("Ten termin jest już zajęty");
    }

    return {
      barberId: barberConfig.id,
      barberName: barberConfig.name
    };
  }

  const { slotMap } = await getAvailableSlotsForAnyBarber(date, env);
  const availableBarbers = slotMap.get(time) || [];

  if (!availableBarbers.length) {
    throw new Error("Ten termin jest już zajęty");
  }

  const chosenBarberId = availableBarbers[0];
  const barberConfig = getBarberConfig(chosenBarberId, env);

  return {
    barberId: barberConfig.id,
    barberName: barberConfig.name
  };
}

async function getAvailableSlots(date, barberId, env) {
  validateDate(date);

  const allSlots = generateSlots();
  const token = await getGoogleAccessToken(env);
  const barber = getBarberConfig(barberId, env);
  const calendarId = barber.calendarId;
  const tz = env.TIMEZONE || "Europe/Warsaw";

  const timeMin = buildGoogleDateRangeStart(date, tz);
  const timeMax = buildGoogleDateRangeEnd(date, tz);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Calendar error: ${txt}`);
  }

  const data = await res.json();
  const events = data.items || [];
  const blocked = new Set();

  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;

    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);

    for (const slot of allSlots) {
      const slotStart = createDateTime(date, slot, tz);
      const slotEnd = new Date(slotStart.getTime() + APPOINTMENT_MINUTES * 60000);

      const overlaps = slotStart < eventEnd && slotEnd > eventStart;
      if (overlaps) blocked.add(slot);
    }
  }

  const now = new Date();
  const nowLocalDate = formatDateInTimeZone(now, tz);
  const nowLocalTime = formatTimeInTimeZone(now, tz);
  const nowMinutes = timeToMinutes(nowLocalTime);
  const closingMinutes = CLOSE_HOUR * 60;

  return allSlots.filter(slot => {
    const slotMinutes = timeToMinutes(slot);
    const slotEndMinutes = slotMinutes + APPOINTMENT_MINUTES;

    if (date < nowLocalDate) return false;
    if (date === nowLocalDate && slotMinutes <= nowMinutes) return false;
    if (slotEndMinutes > closingMinutes) return false;
    if (blocked.has(slot)) return false;

    return true;
  });
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

async function createCalendarEvent(payload, env) {
  const token = await getGoogleAccessToken(env);
  const barber = getBarberConfig(payload.barber, env);
  const calendarId = barber.calendarId;
  const tz = env.TIMEZONE || "Europe/Warsaw";

  const startDateTime = buildLocalDateTime(payload.date, payload.time, tz);
  const endDateTime = buildEndLocalDateTime(payload.date, payload.time, APPOINTMENT_MINUTES, tz);

  const body = {
    summary: `${payload.service} - ${payload.name}`,
    description: [
      `Klient: ${payload.name}`,
      `Email: ${payload.email}`,
      `Telefon: ${payload.phone}`,
      `Usługa: ${payload.service}`,
      `Barber: ${barber.name}`,
      `Tryb wyboru: ${payload.requestedBarber === "any" ? "Dowolny barber" : "Konkretny barber"}`
    ].join("\n"),
    start: {
      dateTime: startDateTime,
      timeZone: tz
    },
    end: {
      dateTime: endDateTime,
      timeZone: tz
    }
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Calendar insert error: ${txt}`);
  }

  return await res.json();
}

async function deleteCalendarEvent(eventId, barberId, env) {
  const token = await getGoogleAccessToken(env);
  const barber = getBarberConfig(barberId, env);
  const calendarId = barber.calendarId;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const txt = await res.text();
    throw new Error(`Calendar delete error: ${txt}`);
  }
}

async function getCalendarEvent(eventId, barberId, env) {
  const token = await getGoogleAccessToken(env);
  const barber = getBarberConfig(barberId, env);
  const calendarId = barber.calendarId;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (res.status === 404 || res.status === 410) {
    throw new Error("Wizyta nie istnieje albo została już odwołana.");
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Calendar read error: ${txt}`);
  }

  return await res.json();
}

async function getCurrentBookingData(data, env) {
  const event = await getCalendarEvent(data.eventId, data.barber, env);
  const tz = env.TIMEZONE || "Europe/Warsaw";

  if (!event.start?.dateTime) {
    throw new Error("Nie udało się odczytać aktualnego terminu wizyty.");
  }

  const eventStart = new Date(event.start.dateTime);
  const currentDate = formatDateInTimeZone(eventStart, tz);
  const currentTime = formatTimeInTimeZone(eventStart, tz);

  return {
    ...data,
    date: currentDate,
    time: currentTime,
    start: buildLocalDateTime(currentDate, currentTime, tz),
    currentEvent: event
  };
}

async function updateCalendarEvent(eventId, payload, env) {
  const token = await getGoogleAccessToken(env);
  const barber = getBarberConfig(payload.barber, env);
  const calendarId = barber.calendarId;
  const tz = env.TIMEZONE || "Europe/Warsaw";

  const startDateTime = buildLocalDateTime(payload.date, payload.time, tz);
  const endDateTime = buildEndLocalDateTime(payload.date, payload.time, APPOINTMENT_MINUTES, tz);

  const body = {
    summary: `${payload.service} - ${payload.name}`,
    description: [
      `Klient: ${payload.name}`,
      `Email: ${payload.email}`,
      `Telefon: ${payload.phone}`,
      `Usługa: ${payload.service}`,
      `Barber: ${barber.name}`,
      "Status: termin zmieniony przez klienta"
    ].join("\n"),
    start: {
      dateTime: startDateTime,
      timeZone: tz
    },
    end: {
      dateTime: endDateTime,
      timeZone: tz
    }
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Calendar update error: ${txt}`);
  }

  return await res.json();
}

function renderReschedulePage(data, token, env) {
  const tz = env.TIMEZONE || "Europe/Warsaw";
  const today = formatDateInTimeZone(new Date(), tz);
  const barberName = data.barberName || getBarberConfig(data.barber, env).name;

  return `
    <h1 style="margin:0 0 18px 0;font-size:28px;color:#f4f1ea;">Zmień termin wizyty</h1>

    <div style="background:#111114;border:1px solid #2b2b31;border-radius:16px;padding:20px;margin:0 0 22px 0;">
      <div style="margin:0 0 10px 0;color:#9f978c;font-size:13px;letter-spacing:1px;text-transform:uppercase;">
        Obecny termin
      </div>

      <p style="margin:0 0 10px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
        <strong style="color:#ffffff;">Barber:</strong> ${escapeHtml(barberName)}
      </p>
      <p style="margin:0 0 10px 0;color:#d4cec4;font-size:16px;line-height:1.7;">
        <strong style="color:#ffffff;">Usługa:</strong> ${escapeHtml(data.service || "-")}
      </p>
      <p style="margin:0;color:#d4cec4;font-size:16px;line-height:1.7;">
        <strong style="color:#ffffff;">Termin:</strong> ${escapeHtml(formatPolishDate(data.date))} ${escapeHtml(data.time)}
      </p>
    </div>

    <form method="POST" action="/reschedule" id="rescheduleForm" style="margin:0;">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <input type="hidden" name="time" id="selectedTime" value="" />

      <label for="newDate" style="display:block;margin:0 0 10px 0;color:#f0e7d8;font-weight:bold;font-size:14px;">
        Nowa data
      </label>
      <input id="newDate" name="date" type="date" min="${escapeHtml(today)}" value="${escapeHtml(data.date)}" style="width:100%;border:1px solid #34343a;background:#1f1f23;color:#f4f1ea;border-radius:14px;padding:14px 16px;font-size:15px;outline:none;margin:0 0 18px 0;" />

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px 0;">
        <h2 style="margin:0;font-size:20px;color:#f4f1ea;">Dostępne godziny</h2>
        <span style="color:#a9a39a;font-size:13px;">pełne godziny</span>
      </div>

      <div id="slots" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 18px 0;"></div>
      <p id="slotMsg" style="margin:0 0 18px 0;color:#a9a39a;font-size:14px;line-height:1.7;">Pobieranie terminów...</p>

      <button type="submit" id="submitBtn" disabled style="appearance:none;border:none;cursor:pointer;display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#17130f;text-decoration:none;border-radius:12px;background:linear-gradient(135deg,#c9a66b,#e0be86);opacity:.55;">
        Potwierdź zmianę terminu
      </button>

      <a href="/cancel?token=${encodeURIComponent(token)}" style="display:inline-block;margin-left:10px;padding:13px 18px;font-size:15px;font-weight:bold;color:#f4f1ea;text-decoration:none;border-radius:12px;background:#2a2a30;border:1px solid #3a3a42;">
        Wróć
      </a>
    </form>

    <script>
      (function () {
        var barber = ${JSON.stringify(data.barber)};
        var dateInput = document.getElementById("newDate");
        var slotsDiv = document.getElementById("slots");
        var slotMsg = document.getElementById("slotMsg");
        var selectedTime = document.getElementById("selectedTime");
        var submitBtn = document.getElementById("submitBtn");

        function setSubmitEnabled(enabled) {
          submitBtn.disabled = !enabled;
          submitBtn.style.opacity = enabled ? "1" : ".55";
        }

        function selectSlot(button, slot) {
          Array.prototype.forEach.call(document.querySelectorAll(".slot-button"), function (item) {
            item.style.background = "#1d1d21";
            item.style.color = "#f4f1ea";
            item.style.borderColor = "#34343a";
          });

          button.style.background = "linear-gradient(135deg,#c9a66b,#e0be86)";
          button.style.color = "#17130f";
          button.style.borderColor = "transparent";
          selectedTime.value = slot;
          setSubmitEnabled(true);
        }

        async function loadSlots() {
          var date = dateInput.value;
          slotsDiv.innerHTML = "";
          selectedTime.value = "";
          setSubmitEnabled(false);

          if (!date) {
            slotMsg.textContent = "Wybierz datę.";
            return;
          }

          slotMsg.textContent = "Pobieranie terminów...";

          try {
            var res = await fetch("/slots?date=" + encodeURIComponent(date) + "&barber=" + encodeURIComponent(barber));
            var result = await res.json();

            if (!res.ok || !result.success) {
              throw new Error(result.message || "Nie udało się pobrać terminów.");
            }

            var slots = result.availableSlots || [];

            if (!slots.length) {
              slotMsg.textContent = "Brak wolnych terminów na wybrany dzień.";
              return;
            }

            slotMsg.textContent = "";

            slots.forEach(function (slot) {
              var button = document.createElement("button");
              button.type = "button";
              button.className = "slot-button";
              button.textContent = slot;
              button.style.appearance = "none";
              button.style.border = "1px solid #34343a";
              button.style.background = "#1d1d21";
              button.style.color = "#f4f1ea";
              button.style.borderRadius = "14px";
              button.style.padding = "13px 8px";
              button.style.fontWeight = "bold";
              button.style.cursor = "pointer";
              button.addEventListener("click", function () {
                selectSlot(button, slot);
              });
              slotsDiv.appendChild(button);
            });
          } catch (err) {
            console.error(err);
            slotMsg.textContent = err.message || "Nie udało się pobrać terminów.";
          }
        }

        dateInput.addEventListener("change", loadSlots);
        loadSlots();
      })();
    </script>
  `;
}

async function sendCustomerRescheduleEmail(payload, previousPayload, event, env) {
  const link = buildGoogleCalendarLink(payload, env);
  const cancelToken = await createCancelToken(payload, event, env);
  const baseUrl = String(env.WORKER_BASE_URL || "").replace(/\/+$/, "");
  const cancelLink = `${baseUrl}/cancel?token=${encodeURIComponent(cancelToken)}`;
  const rescheduleLink = `${baseUrl}/reschedule?token=${encodeURIComponent(cancelToken)}`;
  const subject = `Zmiana terminu wizyty - ${env.SHOP_NAME}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Zmiana terminu wizyty</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;margin:0;padding:0;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                  <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">
                    Zmiana terminu
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:34px 28px 24px 28px;">
                  <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.2;color:#f4f1ea;">Termin wizyty został zmieniony</h1>
                  <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#d4cec4;">
                    Cześć <strong style="color:#ffffff;">${escapeHtml(payload.name || "Kliencie")}</strong>, zapisaliśmy nowy termin Twojej wizyty.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <div style="font-size:13px;color:#9f978c;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Szczegóły zmiany</div>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Poprzedni termin</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(previousPayload.date))} ${escapeHtml(previousPayload.time)}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Nowy termin</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(payload.date))} ${escapeHtml(payload.time)}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.barberName || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.service || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Telefon kontaktowy</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(env.SHOP_PHONE || "-")}</td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 16px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a66b,#e0be86);">
                        <a href="${link}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#17130f;text-decoration:none;border-radius:12px;">Dodaj do kalendarza</a>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:#2a2a30;border:1px solid #3a3a42;">
                        <a href="${rescheduleLink}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#f4f1ea;text-decoration:none;border-radius:12px;">
                          Zmień termin
                        </a>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:#18181b;border:1px solid #3a3a42;">
                        <a href="${cancelLink}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#d4cec4;text-decoration:none;border-radius:12px;">
                          Odwołaj wizytę
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0;font-size:14px;line-height:1.7;color:#b8b1a8;">
                    Wizytę możesz odwołać albo zmienić online najpóźniej do <strong style="color:#ffffff;">1 godziny przed terminem</strong>.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  const textContent = `
Zmiana terminu wizyty

Cześć ${payload.name || "Kliencie"},

Termin wizyty został zmieniony.

Poprzedni termin: ${formatPolishDate(previousPayload.date)} ${previousPayload.time}
Nowy termin: ${formatPolishDate(payload.date)} ${payload.time}
Barber: ${payload.barberName || "-"}
Usługa: ${payload.service || "-"}

Dodaj do kalendarza:
${link}

Zmiana terminu:
${rescheduleLink}

Odwołanie wizyty:
${cancelLink}

${env.SHOP_NAME}
${env.SHOP_PHONE || ""}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: payload.email,
          name: payload.name || "Klient"
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail zmiany terminu do klienta error: ${txt}`);
  }
}

async function sendOwnerRescheduleNotificationEmail(payload, previousPayload, env) {
  const subject = `Zmieniona rezerwacja - ${payload.date} ${payload.time}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Zmieniona rezerwacja</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                  <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">Rezerwacja zmieniona</div>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 28px;">
                  <h2 style="margin:0 0 18px 0;font-size:26px;color:#f4f1ea;">Klient zmienił termin wizyty</h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.barberName || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Klient</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.name || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Email</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.email || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Telefon</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.phone || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.service || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Stary termin</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(previousPayload.date))} ${escapeHtml(previousPayload.time || "-")}</td></tr>
                          <tr><td style="padding:8px 0;color:#9f978c;font-size:14px;">Nowy termin</td><td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(payload.date))} ${escapeHtml(payload.time || "-")}</td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  const textContent = `
Zmieniona rezerwacja

Barber: ${payload.barberName || "-"}
Klient: ${payload.name || "-"}
Email: ${payload.email || "-"}
Telefon: ${payload.phone || "-"}
Usługa: ${payload.service || "-"}
Stary termin: ${formatPolishDate(previousPayload.date)} ${previousPayload.time || "-"}
Nowy termin: ${formatPolishDate(payload.date)} ${payload.time || "-"}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: env.OWNER_EMAIL,
          name: env.SHOP_NAME
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail zmiany terminu do właściciela error: ${txt}`);
  }
}

async function sendCustomerConfirmationEmail(payload, event, env) {
  const link = buildGoogleCalendarLink(payload, env);
  const cancelToken = await createCancelToken(payload, event, env);
  const baseUrl = String(env.WORKER_BASE_URL || "").replace(/\/+$/, "");
  const cancelLink = `${baseUrl}/cancel?token=${encodeURIComponent(cancelToken)}`;
  const rescheduleLink = `${baseUrl}/reschedule?token=${encodeURIComponent(cancelToken)}`;

  const subject = `Potwierdzenie wizyty - ${env.SHOP_NAME}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Potwierdzenie wizyty</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;margin:0;padding:0;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:0;">
                  <div style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">
                      Potwierdzenie rezerwacji
                    </div>
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:34px 28px 20px 28px;">
                  <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.2;color:#f4f1ea;">
                    Wizyta potwierdzona
                  </h1>

                  <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#d4cec4;">
                    Cześć <strong style="color:#ffffff;">${escapeHtml(payload.name)}</strong>,
                    Twoja rezerwacja została zapisana. Wszystko gra.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <div style="font-size:13px;color:#9f978c;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">
                          Szczegóły wizyty
                        </div>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.barberName || "-")}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.service)}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Data</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(formatPolishDate(payload.date))}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Godzina</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.time)}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Telefon kontaktowy</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(env.SHOP_PHONE || "-")}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 16px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a66b,#e0be86);">
                        <a href="${link}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#17130f;text-decoration:none;border-radius:12px;">
                          Dodaj do kalendarza
                        </a>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:#2a2a30;border:1px solid #3a3a42;">
                        <a href="${rescheduleLink}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#f4f1ea;text-decoration:none;border-radius:12px;">
                          Zmień termin
                        </a>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;">
                    <tr>
                      <td align="center" style="border-radius:12px;background:#18181b;border:1px solid #3a3a42;">
                        <a href="${cancelLink}" target="_blank" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#d4cec4;text-decoration:none;border-radius:12px;">
                          Odwołaj wizytę
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0 0 12px 0;font-size:14px;line-height:1.7;color:#b8b1a8;">
                    Wizytę możesz odwołać albo zmienić online najpóźniej do
                    <strong style="color:#ffffff;">1 godziny przed terminem</strong>.
                    Po tym czasie zmiany są możliwe wyłącznie telefonicznie:
                    <strong style="color:#ffffff;">${escapeHtml(env.SHOP_PHONE || "-")}</strong>
                  </p>

                  <p style="margin:0 0 12px 0;font-size:15px;line-height:1.7;color:#d4cec4;">
                    Jeśli coś się zmieni, skontaktuj się z nami odpowiednio wcześniej.
                  </p>

                  <p style="margin:0;font-size:15px;line-height:1.7;color:#d4cec4;">
                    Do zobaczenia,<br />
                    <strong style="color:#ffffff;">${escapeHtml(env.SHOP_NAME)}</strong>
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding:20px 28px 28px 28px;border-top:1px solid #2b2b31;">
                  <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#8d867d;">
                    Ten mail jest potwierdzeniem rezerwacji wizyty.
                  </p>
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#8d867d;">
                    ${escapeHtml(env.SHOP_NAME)}${env.SHOP_PHONE ? ` • tel. ${escapeHtml(env.SHOP_PHONE)}` : ""}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const textContent = `
Potwierdzenie wizyty

Cześć ${payload.name},

Twoja rezerwacja została potwierdzona.

Szczegóły wizyty:
- Barber: ${payload.barberName || "-"}
- Usługa: ${payload.service}
- Data: ${formatPolishDate(payload.date)}
- Godzina: ${payload.time}
- Telefon kontaktowy: ${env.SHOP_PHONE || "-"}

Dodaj do kalendarza:
${link}

Zmiana terminu:
${rescheduleLink}

Odwołanie wizyty:
${cancelLink}

Wizytę można odwołać lub zmienić online najpóźniej 1 godzinę przed terminem.
Później zmiany są możliwe wyłącznie telefonicznie: ${env.SHOP_PHONE || "-"}

Do zobaczenia!
${env.SHOP_NAME}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: payload.email,
          name: payload.name
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail do klienta error: ${txt}`);
  }
}

async function sendOwnerNotificationEmail(payload, env) {
  const subject = `Nowa rezerwacja - ${payload.date} ${payload.time}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Nowa rezerwacja</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                  <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">
                    Nowa rezerwacja
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:30px 28px;">
                  <h2 style="margin:0 0 18px 0;font-size:26px;color:#f4f1ea;">Masz nową wizytę</h2>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.barberName || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Klient</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.name)}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Email</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.email)}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Telefon</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.phone)}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.service)}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Data</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(payload.date))}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Godzina</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.time)}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const textContent = `
Nowa rezerwacja

Barber: ${payload.barberName || "-"}
Klient: ${payload.name}
Email: ${payload.email}
Telefon: ${payload.phone}
Usługa: ${payload.service}
Data: ${formatPolishDate(payload.date)}
Godzina: ${payload.time}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: env.OWNER_EMAIL,
          name: env.SHOP_NAME
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail do właściciela error: ${txt}`);
  }
}

async function sendCustomerCancellationEmail(payload, env) {
  const subject = `Anulowanie wizyty - ${env.SHOP_NAME}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Anulowanie wizyty</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;margin:0;padding:0;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:0;">
                  <div style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">
                      Anulowanie rezerwacji
                    </div>
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:34px 28px 20px 28px;">
                  <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.2;color:#f4f1ea;">
                    Wizyta została odwołana
                  </h1>

                  <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#d4cec4;">
                    Cześć <strong style="color:#ffffff;">${escapeHtml(payload.name || "Kliencie")}</strong>,
                    Twoja rezerwacja została anulowana.
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <div style="font-size:13px;color:#9f978c;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">
                          Szczegóły odwołanej wizyty
                        </div>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.barberName || "-")}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.service || "-")}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Data</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(formatPolishDate(payload.date))}
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Godzina</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">
                              ${escapeHtml(payload.time || "-")}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0;font-size:15px;line-height:1.7;color:#d4cec4;">
                    Jeśli chcesz, możesz zarezerwować nowy termin.<br />
                    <strong style="color:#ffffff;">${escapeHtml(env.SHOP_NAME)}</strong>
                  </p>
                </td>
              </tr>

              <tr>
                <td style="padding:20px 28px 28px 28px;border-top:1px solid #2b2b31;">
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#8d867d;">
                    ${escapeHtml(env.SHOP_NAME)}${env.SHOP_PHONE ? ` • tel. ${escapeHtml(env.SHOP_PHONE)}` : ""}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const textContent = `
Anulowanie wizyty

Cześć ${payload.name || "Kliencie"},

Twoja rezerwacja została anulowana.

Szczegóły odwołanej wizyty:
- Barber: ${payload.barberName || "-"}
- Usługa: ${payload.service || "-"}
- Data: ${formatPolishDate(payload.date)}
- Godzina: ${payload.time || "-"}

${env.SHOP_NAME}
${env.SHOP_PHONE || ""}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: payload.email,
          name: payload.name || "Klient"
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail anulowania do klienta error: ${txt}`);
  }
}

async function sendOwnerCancellationNotificationEmail(payload, env) {
  const subject = `Odwołana rezerwacja - ${payload.date} ${payload.time}`;

  const html = `
  <!DOCTYPE html>
  <html lang="pl">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Odwołana rezerwacja</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f10;font-family:Arial,sans-serif;color:#f4f1ea;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f0f10;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#18181b;border:1px solid #2c2c31;border-radius:20px;overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#c9a66b,#e0be86);padding:18px 24px;text-align:center;">
                  <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#1b1712;font-weight:bold;">
                    Rezerwacja odwołana
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:30px 28px;">
                  <h2 style="margin:0 0 18px 0;font-size:26px;color:#f4f1ea;">Klient odwołał wizytę</h2>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111114;border:1px solid #2b2b31;border-radius:16px;">
                    <tr>
                      <td style="padding:22px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Barber</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.barberName || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Klient</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.name || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Email</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.email || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Telefon</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.phone || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Usługa</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.service || "-")}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Data</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(formatPolishDate(payload.date))}</td>
                          </tr>
                          <tr>
                            <td style="padding:8px 0;color:#9f978c;font-size:14px;">Godzina</td>
                            <td align="right" style="padding:8px 0;color:#f4f1ea;font-size:15px;font-weight:bold;">${escapeHtml(payload.time || "-")}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const textContent = `
Odwołana rezerwacja

Barber: ${payload.barberName || "-"}
Klient: ${payload.name || "-"}
Email: ${payload.email || "-"}
Telefon: ${payload.phone || "-"}
Usługa: ${payload.service || "-"}
Data: ${formatPolishDate(payload.date)}
Godzina: ${payload.time || "-"}
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.MAIL_FROM,
        name: env.SHOP_NAME
      },
      to: [
        {
          email: env.OWNER_EMAIL,
          name: env.SHOP_NAME
        }
      ],
      subject,
      htmlContent: html,
      textContent
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mail anulowania do właściciela error: ${txt}`);
  }
}

async function getGoogleAccessToken(env) {
  const form = new URLSearchParams();

  form.set("client_id", env.GOOGLE_CLIENT_ID);
  form.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  form.set("refresh_token", env.GOOGLE_REFRESH_TOKEN);
  form.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google token error: ${txt}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("Nie udało się pobrać access tokena.");
  }

  return data.access_token;
}

async function createBookingLinks(payload, event, env) {
  const token = await createCancelToken(payload, event, env);
  const baseUrl = String(env.WORKER_BASE_URL || "").replace(/\/+$/, "");

  return {
    calendarLink: buildGoogleCalendarLink(payload, env),
    rescheduleLink: `${baseUrl}/reschedule?token=${encodeURIComponent(token)}`,
    cancelLink: `${baseUrl}/cancel?token=${encodeURIComponent(token)}`
  };
}

async function createCancelToken(payload, event, env) {
  if (!env.CANCEL_SECRET) {
    throw new Error("Brak CANCEL_SECRET w env.");
  }

  if (!env.WORKER_BASE_URL) {
    throw new Error("Brak WORKER_BASE_URL w env.");
  }

  const tz = env.TIMEZONE || "Europe/Warsaw";
  const start = buildLocalDateTime(payload.date, payload.time, tz);

  const tokenPayload = {
    eventId: event.id,
    barber: payload.barber,
    barberName: payload.barberName || "",
    date: payload.date,
    time: payload.time,
    email: payload.email,
    name: payload.name,
    phone: payload.phone,
    service: payload.service,
    start
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = await signString(encodedPayload, env.CANCEL_SECRET);

  return `${encodedPayload}.${signature}`;
}

async function verifyCancelToken(token, env) {
  if (!env.CANCEL_SECRET) {
    throw new Error("Brak CANCEL_SECRET w env.");
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    throw new Error("Nieprawidłowy token.");
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = await signString(encodedPayload, env.CANCEL_SECRET);

  if (signature !== expectedSignature) {
    throw new Error("Nieprawidłowy podpis tokena.");
  }

  let data;

  try {
    const payloadJson = base64UrlDecode(encodedPayload);
    data = JSON.parse(payloadJson);
  } catch {
    throw new Error("Nie udało się odczytać tokena.");
  }

  if (!data.eventId || !data.date || !data.time || !data.start || !data.barber) {
    throw new Error("Token jest uszkodzony.");
  }

  return data;
}

function getCancellationState(startDateTime) {
  const eventStart = new Date(startDateTime);
  const now = new Date();
  const diffMs = eventStart.getTime() - now.getTime();
  const limitMs = CANCEL_LIMIT_MINUTES * 60 * 1000;

  if (diffMs <= 0) {
    return { status: "past" };
  }

  if (diffMs <= limitMs) {
    return { status: "too_late" };
  }

  return { status: "allowed" };
}

async function signString(value, secret) {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return arrayBufferToBase64Url(signature);
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(str) {
  const base64 = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(str.length / 4) * 4, "=");

  return decodeURIComponent(escape(atob(base64)));
}

function buildGoogleCalendarLink(payload, env) {
  const tz = env.TIMEZONE || "Europe/Warsaw";
  const start = createDateTime(payload.date, payload.time, tz);
  const end = new Date(start.getTime() + APPOINTMENT_MINUTES * 60000);

  const text = `${payload.service}`;
  const details = `Wizyta potwierdzona.\nBarber: ${payload.barberName || "-"}\nUsługa: ${payload.service}\nTelefon: ${env.SHOP_PHONE || "-"}`;
  const location = env.SHOP_NAME || "Barber Shop";

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${formatDate(start)}/${formatDate(end)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}&ctz=${encodeURIComponent(tz)}`;
}

function formatDate(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatPolishDate(dateStr) {
  const [year, month, day] = String(dateStr).split("-");
  return `${day}.${month}.${year}`;
}

function generateSlots() {
  const slots = [];

  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }

  return slots;
}

function createDateTime(date, time, timeZone = "Europe/Warsaw") {
  return new Date(buildLocalDateTime(date, time, timeZone));
}

function buildGoogleDateRangeStart(date, timeZone = "Europe/Warsaw") {
  return buildLocalDateTime(date, "00:00", timeZone);
}

function buildGoogleDateRangeEnd(date, timeZone = "Europe/Warsaw") {
  const offset = getTimeZoneOffsetForDate(date, timeZone);
  return `${date}T23:59:59${offset}`;
}

function buildLocalDateTime(date, time, timeZone = "Europe/Warsaw") {
  const offset = getTimeZoneOffsetForDate(date, timeZone);
  return `${date}T${time}:00${offset}`;
}

function buildEndLocalDateTime(date, time, durationMinutes, timeZone = "Europe/Warsaw") {
  const start = new Date(buildLocalDateTime(date, time, timeZone));
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const localDate = formatDateInTimeZone(end, timeZone);
  const localTime = formatTimeInTimeZone(end, timeZone);
  const offset = getTimeZoneOffsetForDate(localDate, timeZone);

  return `${localDate}T${localTime}:00${offset}`;
}

function formatDateInTimeZone(date, timeZone = "Europe/Warsaw") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  return `${year}-${month}-${day}`;
}

function formatTimeInTimeZone(date, timeZone = "Europe/Warsaw") {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const hour = parts.find(p => p.type === "hour").value;
  const minute = parts.find(p => p.type === "minute").value;

  return `${hour}:${minute}`;
}

function getTimeZoneOffsetForDate(date, timeZone = "Europe/Warsaw") {
  const probe = new Date(`${date}T12:00:00Z`);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit"
  }).formatToParts(probe);

  const tzName = parts.find(p => p.type === "timeZoneName")?.value || "GMT+01:00";
  return tzName.replace("GMT", "");
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Nieprawidłowa data");
  }
}

function validateTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Nieprawidłowa godzina");
  }

  const [hours, minutes] = String(time).split(":").map(Number);
  const slotMinutes = hours * 60 + minutes;
  const openingMinutes = OPEN_HOUR * 60;
  const closingMinutes = CLOSE_HOUR * 60;

  if (minutes !== 0) {
    throw new Error("Terminy są dostępne tylko o pełnych godzinach.");
  }

  if (slotMinutes < openingMinutes || slotMinutes + APPOINTMENT_MINUTES > closingMinutes) {
    throw new Error("Godzina jest poza zakresem pracy salonu.");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}