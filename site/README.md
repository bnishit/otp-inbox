# Public project page

Static HTML, CSS and a small guide picker. The public name is OTP Bridge; the repository and URL remain otp-inbox. The page covers the automatic-fill pilot, optional SMS AI observation and separately labelled message-action roadmap. The maintainer hosts it at `/otp-inbox/` on his website; the privacy link refers to that website's separate policy for his personal running instance. It has no backend calls, analytics, signup form, live codes or runtime secrets. Forkers should use their own branding/URLs/privacy policy if hosting a public page.

`assets/otp-orbit.png` is an original ImageGen illustration made for this project. It is a decorative hero asset, not a screenshot or architecture diagram. The text, links and controls are real HTML. Do not represent the illustration as a live inbox.

The Copy setup prompt button copies the README's full setup prompt. After editing that prompt, run `python3 scripts/sync_setup_prompt.py` to update its static HTML copy. Clipboard failure opens and selects the text for manual copying; no request or analytics event is sent.

`privacy/index.html` is the maintainer-instance policy source. Deploy it with the page when data processing changes; it is not a policy for every fork. Feature links and setup instructions target `main`, which includes the browser and SMS observation pilot.
