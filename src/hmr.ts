import { NgModuleRef, ApplicationRef } from '@angular/core';
import { createNewHosts } from '@angularclass/hmr';

export const hmrBootstrap = function(
        module: any,
        bootstrap: () => Promise<NgModuleRef<any>>) {
    let ngModule: NgModuleRef<any>;
    // console.log(module.hot);
    if (module.hot) {
        module.hot.accept();
        bootstrap().then((mod) => {
            ngModule = mod;
        });
        module.hot.dispose(() => {
            const appRef: ApplicationRef = ngModule.injector.get(ApplicationRef);
            const elements = appRef.components.map((c) => c.location.nativeElement);
            const removeOldHosts = createNewHosts(elements);
            ngModule.destroy();
            removeOldHosts();
        });
    }
};
