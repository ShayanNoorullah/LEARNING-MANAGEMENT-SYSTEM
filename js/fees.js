
function feeTotal(studentId){const fs=getData('fees').filter(x=>x.student===studentId);return {total:fs.reduce((a,x)=>a+Number(x.amount),0),paid:fs.filter(x=>x.status==='Paid').reduce((a,x)=>a+Number(x.amount),0),pending:fs.filter(x=>x.status!=='Paid'&&x.status!=='Waived').reduce((a,x)=>a+Number(x.amount),0)}}
