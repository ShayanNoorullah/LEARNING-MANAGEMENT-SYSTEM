
function notificationsFor(user){return getData('notifications').filter(n=>n.user===user.id).sort((a,b)=>new Date(b.date)-new Date(a.date))}
function notificationUI(user,limit=8){return notificationsFor(user).slice(0,limit).map(n=>`<div class="list-item"><div><b>${esc(n.title)}</b><div class="muted">${esc(n.message)}</div><small>${fmtDateTime(n.date)}</small></div>${n.read?'<span class="muted">Read</span>':'<span class="badge-status status-warning">New</span>'}</div>`).join('')||'<div class="empty">No notifications.</div>'}
function markNotificationRead(id){updateRecord('notifications',id,{read:true})}
function markAllRead(user){getData('notifications').filter(n=>n.user===user.id&&!n.read).forEach(n=>updateRecord('notifications',n.id,{read:true}));toast('All notifications marked as read.');location.reload()}
function deleteNotification(id){deleteRecord('notifications',id);toast('Notification deleted.');location.reload()}
