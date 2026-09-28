
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function validPhone(v){return /^[0-9+\-\s]{10,15}$/.test(v)}
function required(v){return String(v||'').trim().length>0}
function validatePassword(v){return String(v||'').length>=6}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
