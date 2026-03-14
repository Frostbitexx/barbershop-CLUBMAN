const API="https://sweet-violet-d22b.rafciuglb.workers.dev"

let selectedSlot=null

const dateInput=document.getElementById("date")
const slotsDiv=document.getElementById("slots")
const msg=document.getElementById("msg")

dateInput.addEventListener("change",loadSlots)

async function loadSlots(){

const date=dateInput.value

const res=await fetch(API+"/slots?date="+date)

const data=await res.json()

slotsDiv.innerHTML=""

data.forEach(slot=>{

const div=document.createElement("div")

div.className="slot"

div.innerText=slot

div.onclick=()=>{

document.querySelectorAll(".slot").forEach(s=>s.classList.remove("selected"))

div.classList.add("selected")

selectedSlot=slot

}

slotsDiv.appendChild(div)

})

}

document.getElementById("book").onclick=async()=>{

const date=dateInput.value
const service = document.getElementById("service").value;
const name=document.getElementById("name").value
const email=document.getElementById("email").value
const phone=document.getElementById("phone").value

if(!selectedSlot){
msg.innerText="Wybierz godzinę"
return
}

const res=await fetch(API+"/book",{
method:"POST",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({
date,
time:selectedSlot,
name,
email,
phone,
service
})
})

const data=await res.json()

msg.innerText=data.message

loadSlots()

}