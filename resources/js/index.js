const {
    remote,
    ipcRenderer,
} = require('electron');
const {
    Menu,
    MenuItem,
    dialog,
} = remote;

const appInfo = {};
const icons = [];

let services = [];
let selectedService = null;
let forwardButton;
let backButton;
let addButton;


// Service context menu
function openServiceContextMenu(event, serviceId) {
    event.preventDefault();
    const service = services[serviceId];

    const menu = new Menu();
    const ready = service.view && service.viewReady, notReady = !service.view && !service.viewReady;
    menu.append(new MenuItem({
        label: 'Home', click: () => {
            service.view.loadURL(service.url)
                .catch(console.error);
        },
        enabled: ready,
    }));
    menu.append(new MenuItem({
        label: ready ? 'Reload' : 'Load', click: () => {
            reloadService(serviceId);
        },
        enabled: ready || notReady,
    }));
    menu.append(new MenuItem({
        label: 'Close', click: () => {
            unloadService(serviceId);
        },
        enabled: ready,
    }));
    menu.append(new MenuItem({type: "separator"}));
    menu.append(new MenuItem({
        label: 'Edit', click: () => {
            ipcRenderer.send('openServiceSettings', serviceId);
        }
    }));
    menu.append(new MenuItem({
        label: 'Delete', click: () => {
            dialog.showMessageBox(remote.getCurrentWindow(), {
                type: 'question',
                title: 'Confirm',
                message: 'Are you sure you want to delete this service?',
                buttons: ['Cancel', 'Confirm'],
                cancelId: 0,
            }).then(result => {
                if (result.response === 1) {
                    ipcRenderer.send('deleteService', serviceId);
                }
            }).catch(console.error);
        }
    }));
    menu.popup({window: remote.getCurrentWindow()});
}


ipcRenderer.on('data', (event, appData, brandIcons, solidIcons, actualServices, actualSelectedService) => {
    // App info
    appInfo.title = appData.title;

    // Icons
    for (const icon of brandIcons) {
        icons.push(icon);
    }
    for (const icon of solidIcons) {
        icons.push(icon);
    }

    console.log('Updating services ...');
    services = actualServices;

    const nav = document.querySelector('#service-selector');
    while (nav.children.length > 0) {
        nav.removeChild(nav.children[0]);
    }

    const serviceContainer = document.querySelector('#services');
    serviceContainer.querySelectorAll(":scope > webview").forEach(w => serviceContainer.removeChild(w));

    for (let i = 0; i < services.length; i++) {
        createService(i);
    }

    if (actualSelectedService < 0 || actualSelectedService >= services.length) {
        actualSelectedService = 0;
    }
    setActiveService(actualSelectedService);
});

ipcRenderer.on('updateService', (e, id, data) => {
    if (id === null) {
        services.push(data);
        createService(services.length - 1);
    } else {
        const nav = document.querySelector('#service-selector');

        // Remove nav
        const oldNavButton = nav.querySelector('li:nth-of-type(' + (id + 1) + ')');
        const nextNavButton = oldNavButton.nextSibling;
        nav.removeChild(oldNavButton);

        // Remove webview
        if (services[id].view) {
            const serviceContainer = document.querySelector('#services');
            serviceContainer.removeChild(services[id].view);
        }

        // Create new service
        services[id] = data;
        createService(id, nextNavButton);
        if (parseInt(selectedService) === id) {
            setActiveService(id);
        }
    }
});

ipcRenderer.on('deleteService', (e, id) => {
    const nav = document.querySelector('#service-selector');

    // Remove nav
    const navButton = nav.querySelector('li:nth-of-type(' + (id + 1) + ')');
    if (navButton) {
        nav.removeChild(navButton);
    }

    // Remove webview
    if (services[id].view) {
        const serviceContainer = document.querySelector('#services');
        serviceContainer.removeChild(services[id].view);
    }

    if (parseInt(selectedService) === id) {
        setActiveService(0);
    }

    delete services[id];
    services = services.filter(s => s !== null);
});

function createService(index, nextNavButton) {
    let service = services[index];
    let li = document.createElement('li');
    service.li = li;

    let button = document.createElement('button');
    button.dataset.serviceId = '' + index;
    button.dataset.tooltip = service.name;
    button.addEventListener('click', () => {
        setActiveService(button.dataset.serviceId);
        ipcRenderer.send('setActiveService', button.dataset.serviceId);
    });
    button.addEventListener('contextmenu', e => openServiceContextMenu(e, index));

    let icon;
    if (service.useFavicon && service.favicon != null) {
        icon = document.createElement('img');
        icon.src = service.favicon;
        icon.alt = service.name;
    } else if (service.isImage) {
        icon = document.createElement('img');
        icon.src = service.icon;
        icon.alt = service.name;
    } else {
        icon = document.createElement('i');
        const iconProperties = icons.find(i => i.name === service.icon);
        if (iconProperties) {
            iconProperties.faIcon.split(' ').forEach(cl => {
                icon.classList.add(cl);
            });
        }
    }

    button.appendChild(icon);
    li.appendChild(button);
    li.button = button;

    const nav = document.querySelector('#service-selector');
    if (nextNavButton === nav || nextNavButton === undefined) {
        nav.appendChild(li);
    } else {
        nav.insertBefore(li, nextNavButton);
    }

    if (service.autoLoad) {
        loadService(index, service);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    forwardButton = document.querySelector('#forward');
    forwardButton.addEventListener('click', () => goForward());

    backButton = document.querySelector('#back');
    backButton.addEventListener('click', () => goBack());

    addButton = document.querySelector('#add-button');
    addButton.addEventListener('click', () => ipcRenderer.send('openServiceSettings', null));
});

function setActiveService(serviceId) {
    const currentService = services[serviceId];
    process.nextTick(() => {
        loadService(serviceId, currentService);

        // Hide previous service
        if (services[selectedService] && services[selectedService].view) {
            services[selectedService].view.classList.remove('active');
        }

        // Show service
        currentService.view.classList.add('active');

        // Save active service ID
        selectedService = serviceId;

        // Refresh navigation
        updateNavigation();
    });
}

function loadService(serviceId, service) {
    // Load service if not loaded yet
    if (!service.view && !service.viewReady) {
        document.querySelector('#services > .loader').classList.remove('hidden');
        service.view = document.createElement('webview');
        service.view.setAttribute('src', service.url);
        service.view.setAttribute('partition', 'persist:service_' + service.partition);
        service.view.setAttribute('autosize', 'true');
        service.view.setAttribute('preload', 'js/service-webview.js');

        // Append element to DOM
        document.querySelector('#services').appendChild(service.view);

        // On load event
        service.view.addEventListener('dom-ready', () => {
            if (service.customCSS) {
                service.view.insertCSS(service.customCSS);
            }

            document.querySelector('#services > .loader').classList.add('hidden');
            updateNavigation();
            service.li.classList.add('loaded');
            service.viewReady = true;

            if (selectedService === null) {
                setActiveService(serviceId);
            }
        });

        // Load favicon
        service.view.addEventListener('page-favicon-updated', event => {
            console.debug('Loaded favicons for', service.name, event.favicons);
            if (event.favicons.length > 0) {
                ipcRenderer.send('setServiceFavicon', serviceId, event.favicons[0]);
                if (service.useFavicon) {
                    const img = document.createElement('img');
                    img.src = event.favicons[0];
                    img.alt = service.name;
                    img.onload = () => {
                        service.li.button.innerHTML = '';
                        service.li.button.appendChild(img);
                    };
                }
            }
        });
    }
}

function unloadService(serviceId) {
    const service = services[serviceId];
    if (service.view && service.viewReady) {
        service.view.remove();
        service.view = null;
        service.li.classList.remove('loaded');
        service.viewReady = false;

        if (parseInt(selectedService) === serviceId) {
            selectedService = null;
            for (let i = 0; i < services.length; i++) {
                if (services[i].view && services[i].viewReady) {
                    setActiveService(i);
                    break;
                }
            }
            if (selectedService === null) {
                updateNavigation();
            }
        }
    }
}

function reloadService(serviceId) {
    const service = services[serviceId];
    if (service.view && service.viewReady) {
        document.querySelector('#services > .loader').classList.remove('hidden');
        service.view.reload();
    } else if (!service.view && !service.viewReady) {
        loadService(serviceId, service);
    }
}

function updateNavigation() {
    console.debug('Updating navigation');
    // Update active list element
    for (let i = 0; i < services.length; i++) {
        const service = services[i];
        if (parseInt(selectedService) === i) {
            service.li.classList.add('active');
        } else {
            service.li.classList.remove('active');
        }
    }

    if (selectedService !== null && services[selectedService].viewReady) {
        console.debug('Updating navigation buttons because view is ready');
        // Update history navigation
        let view = services[selectedService].view;

        if (view && view.canGoForward()) forwardButton.classList.remove('disabled');
        else forwardButton.classList.add('disabled');

        if (view && view.canGoBack()) backButton.classList.remove('disabled');
        else backButton.classList.add('disabled');
    }

    updateWindowTitle();
}

function updateWindowTitle() {
    if (selectedService === null) {
        ipcRenderer.send('updateWindowTitle', null);
    } else {
        ipcRenderer.send('updateWindowTitle', selectedService, services[selectedService].view.getWebContents().getTitle());
    }
}

function goForward() {
    let view = services[selectedService].view;
    if (view) view.getWebContents().goForward();
}

function goBack() {
    let view = services[selectedService].view;
    if (view) view.getWebContents().goBack();
}