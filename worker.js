export default {

async fetch(request){

const url=new URL(request.url)

if(url.pathname=="/slots"){

const date=url.searchParams.get("date")

return new Response(JSON.stringify(generateSlots(date)),{
headers:{'content-type':'application/json'}
})

}

if(url.pathname=="/book"){

const body=await request.json()

return new Response(JSON.stringify({
message:"Rezerwacja zapisana (demo)"
}))

}

return new Response("API")
}

}

function generateSlots(){

const slots=[]

for(let h=8;h<21;h++){

slots.push(`${h.toString().padStart(2,'0')}:00`)
slots.push(`${h.toString().padStart(2,'0')}:30`)

}

return slots
}