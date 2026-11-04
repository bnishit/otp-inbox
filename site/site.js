const picker=document.querySelector('#guide-picker');
const source=document.querySelector('#source');
const notes={iphone:'iPhone: generated Shortcut + personal Message automation.',android:'Android: Tasker recipe. Physical-device testing still needed.','gmail-polling':'Gmail: private Apps Script collector, one setup per mailbox.','gmail-push':'Gmail: your Google Cloud project + authenticated push, with minute polling kept as backup.'};
source.addEventListener('change',()=>{document.querySelector('#guide-note').textContent=notes[source.value];});
picker.addEventListener('submit',event=>{event.preventDefault();if(Object.hasOwn(notes,source.value))window.location.href='https://github.com/bnishit/otp-inbox/blob/main/docs/'+source.value+'.md';});
