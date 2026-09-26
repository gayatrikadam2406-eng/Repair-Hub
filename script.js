function estimateCost(){

let problem=document.getElementById("problem").value;

let cost="";

if(problem==="Minor Issue"){

cost="Estimated Cost : ₹500";

}

else if(problem==="Major Issue"){

cost="Estimated Cost : ₹1500";

}

else if(problem==="Replacement Required"){

cost="Estimated Cost : ₹3000";

}

else{

cost="Please select a problem.";

}

document.getElementById("result").innerHTML=cost;

}

function bookOtherRepair(){

    let appliance = document.getElementById("otherAppliance").value;

    if(appliance.trim()==""){

        alert("Please enter your appliance name.");

    }else{

        window.location.href="booking.html";

    }

}