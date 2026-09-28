
function sendMessage(data){const m=addRecord('messages',{...data,date:new Date().toISOString(),read:false});makeNotification(data.to,'New Message',`New message from ${findRecord('users',data.from)?.name||'User'}: ${data.subject}`,'Message');toast('Message sent successfully.');return m}
