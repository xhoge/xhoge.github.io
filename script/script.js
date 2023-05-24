
function createSidebar() {
  const sidebar = document.getElementById("sidebar");

  fetch("./json/sidemenu.json",{cache:"no-cache"})
    .then(response => response.json())
    .then(data => {
      const menuItems = data.menuItems;

      menuItems.forEach(menuItem => {
        const menuElement = document.createElement("a");
        menuElement.href = menuItem.link;
        menuElement.textContent = menuItem.text;

        sidebar.appendChild(menuElement);
      });
    })
    .catch(error => {
      console.error("JSONファイルの読み込みに失敗しました", error);
    });
}