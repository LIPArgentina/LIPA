document.addEventListener("DOMContentLoaded", () => {
  const contact = document.querySelector(".site-footer__contact");
  const closeButton = document.getElementById("closeDeveloperContact");

  closeButton?.addEventListener("click", () => contact?.removeAttribute("open"));
});
