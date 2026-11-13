import { LEGACY_PROFILES } from './sqlite-history-profiles-legacy.mjs';
import { OCTOBER_PROFILES } from './sqlite-history-profiles-october.mjs';

// Private canonical functions: verify before importing, re-audit on upgrades.
export const PROFILES = {
  ...LEGACY_PROFILES,
  ...OCTOBER_PROFILES,
  // Exact 11.1 owners traced from the native chat/SDK import graph.
  '2026.11.1': {
  "nativeIdentity": true,
  "pins": {
    "chat-history-pages-D7C0cycq.mjs": "f72a499ea144632e12b3b0c47c655c7c0f099a517eca19d23ba09e8a0f952390",
    "chat-history-response-page-BqyuqQqH.mjs": "a49ab481fdfc3b670e24c104e8a0123661b8c619cb172cb25d9115f47504b458",
    "chat-history-page-kernel-D9oaHrn6.mjs": "96bec7641b3feffe9b35e63c25406000b1b91ada1d71d76ba6ea1379872a0fff",
    "chat-history-reply-messages-DmC0TWCG.mjs": "98aabf0251a1a8fb5c08ea2bd1f264c7bc7b30748275e2e3926d7814e567206b",
    "session-transcript-readers-DMEsPkgl.mjs": "fc9f418bbddc98a444185fb0e24e7ec24d4c104ec0e578b42374806e0fe3d65c",
    "transcript-image-artifacts-BNfLH5hX.mjs": "c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca",
    "session-accessor.sqlite-transcript-watermark-W3OQhsCR.mjs": "ce8262cdf2f0e6977987125d00020047d1d0295d5282093f60c6125953190324",
    "session-accessor.sqlite-transcript-watermark-read-CYouyMy6.mjs": "506af68679722e6b4c715c8834b893b89e6680368c5138b8423e28cde87a33c9",
    "session-cold-storage-state-TYOy0MI2.mjs": "b7f88ddbd5188271231312899f7f8f376adfee4afccc9695fcf43f50e74db4bd",
    "openclaw-agent-db-readonly-DZrLhKc-.mjs": "c80d36de6459fc9c98567733adb738ec0485bafac364601bd602a0ba294f41d1",
    "openclaw-agent-db-readonly-open-D9xg_dzT.mjs": "6ae8e48b7e8c21a7068f47722c496c23c7f068333676364c09709e89bf036cfa",
    "openclaw-agent-db-readonly-scope-D1SvL5y6.mjs": "54e65016547158bd24be439d548f2099fad13fdc02d76d8d82fc4f9c63a75f16",
    "session-history-worker-runtime-qxdutElk.mjs": "9aafc9e4932676d60ca0d467cd602e1b3acfac1d46cc02cd7ab5ad63b0713386",
    "session-history-worker-runtime-Bixe82Sr.mjs": "3d1e775465e01f62472192e0c525ef6e6f1a0c1986183f2d63a5eb16f576d195",
    "session-history-worker-reader-DVUcuNKZ.mjs": "f3fe907308e352ef3e175ec1e950be8feb640cf34d5eaf729d8e15cb8bdc081a",
    "runtime-process-entrypoints-BMmG9cQl.mjs": "c06ba843e61d4e0b36949760674ade773ace200d8c1553529fadc0511fa111b4",
    "plugin-sdk/session-store-runtime.js": "9b045210cf023af002a7af452aee12e16ca1655c1f1921e3b4cdee0ea8c7a14a",
    "session-store-runtime-C90fYIWD.mjs": "1cc9906618d214670f501d4da5d637bcd226567df5723ae8cbf53f69a9bd7986",
    "session-store-runtime-internal-C-yzUCF6.mjs": "dc396b31e671ffc32bbd3e7ed7a88210cb523c9cd29e1de96dfc5083e8c9d7fc",
    "session-accessor.sqlite-entry-CqDNc6sf.mjs": "660cc7b10979f5792b7232b1e0d9ee78ae3c23fc5748621bea7686bf93a0ce43",
    "session-accessor.sqlite-entry-read-Apcn2sJr.mjs": "c22f4ba9823f3f16c63087f4bb185872d99297aa7f78d8bcac77311cb3b304e5",
    "session-accessor.sqlite-entry-identity-pPbafEKY.mjs": "fd13e3d64fefb9849b961048d9919d06c6d001f7c8ad0d98c7de1cc8e36f73fc",
    "session-accessor.sqlite-entry-list.read-CHKWrCRl.mjs": "754dee3b709422856a66d2e2aff211ae398b0092fb50d239b674be6122a4899f",
    "session-utils.fs-BfASFo7x.mjs": "72b59b946f5fa37f31114f83b6dc33b178ba816f9690879d1fdbdf1e52110415",
    "chat-history-budget-BS2u2Rmt.mjs": "cda2c0b250afbfce5ec29c430bc9797679606075f81081b53a086dab345331c5",
    "cli-session-history-J1zARcgg.mjs": ["081ee0d5cc47d6e678c9119f21604336ab5e0d31fc1e3c74988782b704bd3e93", "95aa1bf715ac6454a80c82350dfa847a085835db26574be0519d790e51b28f1d"]
  },
  "entrypoints": [
    "runtime-process-entrypoints-BMmG9cQl.mjs",
    "n"
  ],
  "bindings": {
    "chat": {
      "i": [
        "chat-history-pages-D7C0cycq.mjs",
        "n"
      ],
      "r": [
        "chat-history-response-page-BqyuqQqH.mjs",
        "n"
      ],
      "c": [
        "chat-history-budget-BS2u2Rmt.mjs",
        "c"
      ]
    },
    "preparePage": [
      "chat-history-response-page-BqyuqQqH.mjs",
      "r"
    ],
    "readers": [
      "session-utils.fs-BfASFo7x.mjs",
      "t"
    ],
    "display": [
      "transcript-image-artifacts-BNfLH5hX.mjs",
      "i"
    ],
    "accessor": [
      "session-accessor.sqlite-transcript-watermark-W3OQhsCR.mjs",
      "t"
    ]
  }
},
  // Exact 11.3 owners: the 11.1 chat/SDK import graph with renamed chunks and
  // unchanged bodies. resolveSqliteTranscriptReadScope and resolveSqliteScope
  // moved verbatim into session-accessor.sqlite-read-scope, pinned here.
  '2026.11.3': {
    "nativeIdentity": true,
    "pins": {
      "chat-history-pages-uusZwz8Y.mjs": "f20da3ec946dd13c44c7e7c26534cb723062442e6e94202179b77bdfb36ea3a6",
      "chat-history-response-page-eaictgfh.mjs": "855d0cf45b95cb44bf3567cedaade929b76cff81294035df0dc75e647af660db",
      "chat-history-page-kernel-CM015Z8o.mjs": "9a90e2807837b0602422d5e6e3d37e331468b8bca9f73049aa8c5d44958f71af",
      "chat-history-reply-messages-Dtn88Z4R.mjs": "ebeda19c805013c8cbfab9604bef6ef8875211b10949843926860878ef92369c",
      "session-transcript-readers-sEN0giif.mjs": "03d50332af0b9d8cbf810af707784853b8fa0f2bfb6eda27fef9ba79455a7a6e",
      "transcript-image-artifacts-BNfLH5hX.mjs": "c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca",
      "session-accessor.sqlite-transcript-watermark-CfdOKFaq.mjs": "c8b2608bda177d2eb5fd29fda0590a2930a53bcd9d0f9d1a1cae312454732914",
      "session-accessor.sqlite-transcript-watermark-read-LkTRNCnP.mjs": "5cd104421a11ec1be574225542febcf5d5649109344795e32a1b764073a7d4e9",
      "session-cold-storage-state-CWFSrppd.mjs": "f4924ad41de2d450db5f67dd904274f7e071c6c0ba683022fca933adcbea4633",
      "openclaw-agent-db-readonly-DYvA41kd.mjs": "7e1469beaaa3496777c936284c5676e045864220900063f2a494a031fc00eb4f",
      "openclaw-agent-db-readonly-open-DcexysGa.mjs": "fad866515924c9c52f1e89e3f6dfd4d156b666bb4ab195e7deb5ca2476cf6f57",
      "openclaw-agent-db-readonly-scope-DUxQ_9sC.mjs": "4611752824c29864401731bc49d61567040d9e542c38a07dddd30a42ef849f32",
      "session-history-worker-runtime-BDgtzr9p.mjs": "4f912862efb3d394742894f5b5c6f5a7d300b6a1071df343707e1054b8c7c401",
      "session-history-worker-runtime-cLJ9ttb9.mjs": "ae2bfd001ce8b1655a333e5c20f330dc573a77d374f14fa759c097bf5bf78e21",
      "session-history-worker-reader-MgrQKN8X.mjs": "69dcf005528ef7b2de863434b8abc88153710e4fe9e564cb9d0950ab0190ed02",
      "runtime-process-entrypoints-BMmG9cQl.mjs": "c06ba843e61d4e0b36949760674ade773ace200d8c1553529fadc0511fa111b4",
      "plugin-sdk/session-store-runtime.js": "f37bd16bcee20fd5e1b160a674b65243aa43c080c349d7b63b7dccc90a4fb824",
      "session-store-runtime-ZXyBmsi7.mjs": "409ca9cf2f672b67bf262e97fd4abf4af832565513f8fd8b7ea908030111139a",
      "session-store-runtime-internal-Cv2I3LCC.mjs": "a113287d1837e694d2b533571076ebfe653de5e5a7832f14752c30f7a864e198",
      "session-accessor.sqlite-entry-DQgFS9_A.mjs": "4ad2762ed128e4c21be663145dc0883f17f5bec918ef834ca111ced7e671a515",
      "session-accessor.sqlite-entry-read-CLHpEbhT.mjs": "c08bf58816d5f67ef445d00ec56620a13a2f97b437dfb649253030494f4fa714",
      "session-accessor.sqlite-entry-identity-DNiqiZkm.mjs": "be5503389539019791fba5e5064c29dc5ee430d076e3ae21d013ab2407e8e314",
      "session-accessor.sqlite-entry-list.read-BLfvs7b2.mjs": "3d9f1026a4ec8e0d77bdf711132a728acd7d5d883ec3890e0ab30214a23e26a5",
      "session-utils.fs-BfASFo7x.mjs": "72b59b946f5fa37f31114f83b6dc33b178ba816f9690879d1fdbdf1e52110415",
      "chat-history-budget-zn9U6Nmg.mjs": "c4465252a66d4b3a51b98197a9bd8271d80c28952512a9e7a896ba3c85ca4b87",
      "cli-session-history-BUQf1rvS.mjs": ["18deaf86d0e4eb6e9e7951c6d4b412ee68516f9cfe9e052d762ef0a318439a33", "fcb3ea9e356768c56ac9928548c74d163bfb31d335e8579096553f02b61a23ba"],
      "session-accessor.sqlite-read-scope-DzGQuOfU.mjs": "8fc7cc331bfc979ad43821b3e7f20e2197a2e324694211e37fca94f87ec1bc33"
    },
    "entrypoints": [
      "runtime-process-entrypoints-BMmG9cQl.mjs",
      "n"
    ],
    "bindings": {
      "chat": {
        "i": [
          "chat-history-pages-uusZwz8Y.mjs",
          "n"
        ],
        "r": [
          "chat-history-response-page-eaictgfh.mjs",
          "n"
        ],
        "c": [
          "chat-history-budget-zn9U6Nmg.mjs",
          "c"
        ]
      },
      "preparePage": [
        "chat-history-response-page-eaictgfh.mjs",
        "r"
      ],
      "readers": [
        "session-utils.fs-BfASFo7x.mjs",
        "t"
      ],
      "display": [
        "transcript-image-artifacts-BNfLH5hX.mjs",
        "i"
      ],
      "accessor": [
        "session-accessor.sqlite-transcript-watermark-CfdOKFaq.mjs",
        "t"
      ]
    }
  },
};
