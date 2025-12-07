import { Observable, EventData, Page } from '@nativescript/core';
import { DemoSharedNativescriptNfc } from '@demo/shared';
import { Nfc, NfcNdefData } from '@ghlabs/nativescript-nfc';

export function navigatingTo(args: EventData) {
  const page = <Page>args.object;
  page.bindingContext = new DemoModel();
}

export class DemoModel extends DemoSharedNativescriptNfc {
  private nfc: Nfc;
  private _statusMessage: string = 'Ready';

  constructor() {
    super();
    this.nfc = new Nfc();
  }

  get statusMessage(): string {
    return this._statusMessage;
  }

  set statusMessage(value: string) {
    if (this._statusMessage !== value) {
      this._statusMessage = value;
      this.notifyPropertyChange('statusMessage', value);
    }
  }

  checkAvailability() {
    this.nfc
      .available()
      .then((available) => {
        if (available) {
          this.statusMessage = 'NFC is available on this device';
        } else {
          this.statusMessage = 'NFC is NOT available on this device';
        }
      })
      .catch((error) => {
        this.statusMessage = 'Error checking NFC availability: ' + error;
      });
  }

  startScan() {
    this.statusMessage = 'Starting NFC scan...';

    this.nfc
      .setOnNdefDiscoveredListener(
        (data: NfcNdefData) => {
          console.log('NFC Tag discovered:', JSON.stringify(data));
          this.statusMessage = 'NFC Tag detected!\n' + JSON.stringify(data.message, null, 2);
        },
        {
          stopAfterFirstRead: true,
          scanHint: 'Hold your device near an NFC tag',
        },
      )
      .then(() => {
        this.statusMessage = 'NFC scan started. Ready to scan tags...';
      })
      .catch((error) => {
        this.statusMessage = 'Error starting NFC scan: ' + error;
      });
  }

  stopScan() {
    this.nfc
      .setOnNdefDiscoveredListener(null)
      .then(() => {
        this.statusMessage = 'NFC scan stopped';
      })
      .catch((error) => {
        this.statusMessage = 'Error stopping NFC scan: ' + error;
      });
  }
}
