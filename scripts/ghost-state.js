class GhostState {
    constructor(targetSelector = '.paper-layer') {
        this.targetSelector = targetSelector;
        this.container = document.body;
        this.ticking = false;
        this.initScrollGhosts();
    }

    initScrollGhosts() {
        let lastScroll = window.scrollY;
        window.addEventListener('scroll', () => {
            const currentScroll = window.scrollY;
            const delta = currentScroll - lastScroll;
            
            if (Math.abs(delta) > 5 && !this.ticking) {
                window.requestAnimationFrame(() => {
                    this.spawnGhost(delta);
                    this.ticking = false;
                });
                this.ticking = true;
            }
            lastScroll = currentScroll;
        });
    }

    spawnGhost(velocity) {
        const targets = document.querySelectorAll(this.targetSelector);
        if (!targets.length) return;

        targets.forEach(target => {
            const rect = target.getBoundingClientRect();
            const ghost = target.cloneNode(true);
            
            ghost.classList.add('temporal-bleed');
            ghost.style.top = `${rect.top + window.scrollY}px`;
            ghost.style.left = `${rect.left}px`;
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
            ghost.style.transform = `translateY(${-velocity * 0.8}px)`;

            this.container.appendChild(ghost);

            setTimeout(() => ghost.remove(), 800);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => new GhostState());
