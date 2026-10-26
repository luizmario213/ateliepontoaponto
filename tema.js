/* Aplica o tema salvo antes da página aparecer (evita piscar). */
(function(){try{var t=localStorage.getItem("pap-tema");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}})();
