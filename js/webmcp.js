/* WebMCP tools — lets AI agents driving a browser query OnlineFix
   directly (prices, hours, booking policy) instead of scraping the page.
   Read-only: no tool changes any state. No-ops silently in browsers
   without navigator.modelContext, so regular visitors are unaffected.
   Keep the data below in lockstep with llms.txt and the on-page schema. */
(function () {
    'use strict';
    var mc = navigator.modelContext;
    if (!mc) return;

    var BUSINESS = {
        name: 'OnlineFix',
        summary: 'Independent electronics repair workshop in Guildford, Surrey (UK), founded 2018, run by owner and lead technician Tomas.',
        phone: '+44 7940 730537',
        whatsapp: 'https://wa.me/447940730537',
        email: 'hello@onlinefix.uk',
        address: 'Guildford, Surrey, GU1 4PD, United Kingdom',
        areaServed: 'Guildford, Woking, Farnham, Godalming and the rest of Surrey',
        hours: 'Open 7 days a week, 10:00-22:00 (calls and messages)',
        booking: 'Appointment only — no walk-ins. Call or message 07940 730537 to arrange a drop-off time.',
        policies: 'No fix, no fee. 90-day warranty on all repairs. A small diagnostic fee applies and is credited towards the repair.',
        turnaround: 'Most repairs same-day or within 24-48 hours, on-site (devices are not sent away). Complex board-level or motherboard repairs start from £90 and can take 1-2 weeks.'
    };

    var SERVICES = [
        { device: 'PlayStation (PS5, PS4, PS3)', url: 'https://onlinefix.co.uk/playstation-repair.html', prices: 'PS5 HDMI port £80 (PS4 from £60), PS5 disk drive £110, Blue Light of Death from £90, deep clean with thermal paste PS5 £70 / PS4 from £30' },
        { device: 'Xbox (Series X/S, One)', url: 'https://onlinefix.co.uk/xbox-repair.html', prices: 'Series X HDMI port £80 (Series S/One from £60), disk drive from £55 (Series X £110), power supply from £65, deep clean from £30 (Series X £70)' },
        { device: 'Nintendo Switch and other consoles', url: 'https://onlinefix.co.uk/console-repair.html', prices: 'HDMI ports from £60, disk drives from £55, overheating/deep clean from £30' },
        { device: 'iPhone and other phones (Samsung, Google Pixel)', url: 'https://onlinefix.co.uk/iphone-repair.html', prices: 'screens from £45, batteries from £35, charging ports from £45, water damage from £55' },
        { device: 'MacBook', url: 'https://onlinefix.co.uk/macbook-repair.html', prices: 'logic board repair from £95, screens from £149, batteries from £79, keyboards from £89, water damage from £85' },
        { device: 'Laptop (HP, Lenovo, Dell, ASUS, Acer, MSI and more)', url: 'https://onlinefix.co.uk/laptop-repair.html', prices: 'screens from £60, diagnosis from £30, SSD upgrades from £40 plus the drive, virus removal from £35' },
        { device: 'Desktop PC and gaming PC', url: 'https://onlinefix.co.uk/pc-repair.html', prices: 'hardware diagnosis from £30, virus removal from £35, SSD/RAM upgrade labour from £25, Windows installation from £35' },
        { device: 'Tablet and iPad', url: 'https://onlinefix.co.uk/tablet-repair.html', prices: 'screens from £55, batteries from £45, charging ports from £45' },
        { device: 'Data recovery (drives, SSDs, phones, RAID)', url: 'https://onlinefix.co.uk/data-recovery.html', prices: 'deleted files from £45, failed hard drives from £55, SSDs from £65, phones from £45, RAID from £85 — no data recovered, no fee' }
    ];

    function text(s) {
        return { content: [{ type: 'text', text: s }] };
    }

    function serviceLines(list) {
        return list.map(function (s) {
            return '- ' + s.device + ': ' + s.prices + ' (' + s.url + ')';
        }).join('\n');
    }

    var TOOLS = [
        {
            name: 'get_business_info',
            description: 'Contact details, location, opening hours, booking policy, warranty and turnaround for OnlineFix electronics repair in Guildford, Surrey.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            execute: function () {
                return text(
                    BUSINESS.name + ' — ' + BUSINESS.summary + '\n' +
                    'Phone: ' + BUSINESS.phone + ' | WhatsApp: ' + BUSINESS.whatsapp + ' | Email: ' + BUSINESS.email + '\n' +
                    'Address: ' + BUSINESS.address + ' | Serves: ' + BUSINESS.areaServed + '\n' +
                    'Hours: ' + BUSINESS.hours + '\n' +
                    'Booking: ' + BUSINESS.booking + '\n' +
                    'Policies: ' + BUSINESS.policies + '\n' +
                    'Turnaround: ' + BUSINESS.turnaround
                );
            }
        },
        {
            name: 'list_repair_services',
            description: 'Full catalogue of repair services and starting prices at OnlineFix Guildford: consoles, phones, MacBooks, laptops, PCs, tablets and data recovery.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            execute: function () {
                return text('OnlineFix repair services and prices:\n' + serviceLines(SERVICES) + '\n\n' + BUSINESS.policies);
            }
        },
        {
            name: 'get_repair_prices',
            description: 'Repair prices for a specific device type (e.g. "PS5", "iPhone", "MacBook", "laptop", "Xbox", "iPad", "data recovery") at OnlineFix Guildford.',
            inputSchema: {
                type: 'object',
                properties: {
                    device: {
                        type: 'string',
                        description: 'Device or service to price, e.g. "PS5", "iPhone 13", "MacBook Air", "gaming PC", "SSD data recovery"'
                    }
                },
                required: ['device'],
                additionalProperties: false
            },
            execute: function (args) {
                var q = String((args && args.device) || '').toLowerCase();
                var words = q.split(/[^a-z0-9+]+/).filter(function (w) { return w.length >= 2; });
                var hits = SERVICES.filter(function (s) {
                    var hay = (s.device + ' ' + s.prices).toLowerCase();
                    return words.some(function (w) { return hay.indexOf(w) !== -1; });
                });
                if (!hits.length) hits = SERVICES; // unknown device: return the full list
                return text(
                    'Prices (exact quote after free-with-repair diagnosis):\n' + serviceLines(hits) +
                    '\n\n' + BUSINESS.policies + '\nTurnaround: ' + BUSINESS.turnaround +
                    '\nBook: ' + BUSINESS.booking
                );
            }
        }
    ];

    if (typeof mc.provideContext === 'function') {
        mc.provideContext({ tools: TOOLS });
    } else if (typeof mc.registerTool === 'function') {
        TOOLS.forEach(function (t) { mc.registerTool(t); });
    }
})();
