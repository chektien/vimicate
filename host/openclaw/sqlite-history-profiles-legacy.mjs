// Reviewed historical reader fingerprints. Unknown bytes still fail before import.
export const LEGACY_PROFILES = {
  '2026.8.1': { pins: {
    'chat-BMcwuITo.js': '9007bc9669232ee6b509d8be23816937fdfa6ddaec07a6842227cfb93113a732',
    'session-transcript-readers-DeuWju3t.js': 'c477dc9cbb7e75572a292746fa1dbfa6cb1879171395576366d40666bc27dedf',
    'transcript-display-position-DBvQU6E0.js': '4270a212778a6fb9e8cf2827373450b9900c13c79d3895e4140e8a70bafc1dcf',
    'session-accessor-Dwfzn6Ej.js': '3acfb49a513c69e6cda97cda209dc4e14401144e2fff593e817e19b63c29028c',
  }, chatKeys: ['i', 'r', 'c', 'a', 'o'] },
  '2026.9.1': { pins: {
    'chat-D3QlhTHk.js': '46cc543fcae72d21622b04ab90148711b1fbe304504476c5a6ea944785acecaf',
    'session-transcript-readers-Bry9KBsD.js': '2d3e63ccfe50a59f95562d2653912e6184b131745379c063d3255fb6148b2840',
    'transcript-display-position-3BMmjSOO.js': '0ee830acfa2e4f26b6b30ec42f5776a2117cbfa48c842da18b67990c2721832a',
    'session-accessor-K0XuW6ln.js': '3b18271baa0cc644ab805ab077db73f4f331bc6bd42a85707bfaadab52a7bc08',
  }, chatKeys: ['a', 'i', 'l', 'o', 's'] },
  '2026.9.2': { pins: {
    // Stock reader and audited local CLI pagination repair; native-only ports
    // remain unchanged. Unknown runtime bytes still fail before import.
    'chat-IsrqkYID.js': ['b0387dcd7a41f60618f336cebbf9f01c21ac4cef83cda08e69fdc3bf9abc2e0a',
      '089008b662cbd21bedb902ca02d4ac6c1c84ad391c451a825bbb4e55a6949119'],
    'session-transcript-readers-CYDRQsH5.js': '6435d6948bafc69c5153f3ff39b51c3960696e3c2bbb494f84b4db60e4b70e07',
    'transcript-display-position-3BMmjSOO.js': '0ee830acfa2e4f26b6b30ec42f5776a2117cbfa48c842da18b67990c2721832a',
    'session-accessor-YsytfDtG.js': '2ea609177c0f1a6f1821c4257f359bbe2c9c04bda30a8c8c305b59c9d4094209',
  }, chatKeys: ['a', 'i', 'l', 'o', 's'], readersKey: 'v', accessorKey: 'i' },
  '2026.9.4': { pins: {
    // History handling moved out of chat; pin the actual canonical owner.
    // Stock and audited CLI display-pagination port; ignoreCliSessionImports
    // keeps the native archived offset reader unchanged in both variants.
    'chat-history-handler-DpOELHcj.mjs': ['96b59d169f7c1eff4960b93f1bcbddfeaf89cb9edae153f89d2ce37b00aaebc9',
      '9e7a85efba39d40793fc3be92bc4a4844ed858828d8cac29cb1554a29bad3b06'],
    'session-transcript-readers-BZjuw2hz.mjs': '799a71b9b95715ec03d74b543fd1b5c43c8b4374a840d64079db5e82db4e394c',
    'transcript-display-position-CMxuw6wB.mjs': '4782025bdf5ddcd847d0e78725aeb458634536891107a3f2042148134b74cfe8',
    'session-accessor-BxcCxteu.mjs': 'f59cc36b974aa4ada62a700be36499c5e33e16676d8ba0b1a6bec3518e8ebbe5',
  }, chatKeys: ['a', 'i', 'l', 'o', 's'], readersKey: 'y', accessorKey: 'i' },
  '2026.9.5': { pins: {
    // The 9.5 history implementation is split across dedicated page-kernel,
    // read-target and display modules. Pin every private module from which the
    // adapter selects an export, plus the concrete accessor implementation
    // behind the public barrel.
    'chat-history-handler-CNCCSwHI.mjs': ['944cf51c08b4f1e1581f533b94d95779296d6c3b8766ddd00256463f13be6fd2',
      '3073ab534d9a1520673b63f6e693caf4350570a8fb907033f26636ec5ad67d15'],
    'chat-history-page-kernel-B_OMtrrG.mjs': '816058c6eb9b6584f19fed249aab1a3a78084b59449b743c6e405324ba2ca7f7',
    'session-transcript-read-target-DZrRgS-U.mjs': '04e711899152689553f6bbfb38c0468c6a4e036eb829130cb91bbd226902ad3e',
    'session-transcript-message-CG0gvj2K.mjs': '9435b568d31ad2ed0a0a98c29f82aaf1445bdbcbda4efb2aa5a558835003e89a',
    'session-accessor-CVGnifXR.mjs': 'ddd55cd25fd14cd2977012fbc6c60960288269571d22352fae877e5cb572c0f6',
    'session-accessor.sqlite-branches-B1TOrGRb.mjs': '2fc8cdceebce77f26f0d5c641f4963022281bb6270a6aaf37bbf34772c50d878',
  }, bindings: {
    chat: {
      i: ['chat-history-handler-CNCCSwHI.mjs', 'i'],
      r: ['chat-history-page-kernel-B_OMtrrG.mjs', 'n'],
      c: ['chat-history-handler-CNCCSwHI.mjs', 'o'],
      a: ['chat-history-page-kernel-B_OMtrrG.mjs', 'i'],
    },
    readers: ['session-transcript-read-target-DZrRgS-U.mjs', 'i'],
    display: ['session-transcript-message-CG0gvj2K.mjs', 'n'],
    accessor: ['session-accessor-CVGnifXR.mjs', 'readSessionTranscriptWatermark'],
  } },
  '2026.9.6': { pins: {
    // 9.6 moved page reading and oversize replacement into chat-history-pages,
    // which the local Claude history repair also patches (stock or repaired).
    // Selected functions match 9.5 except the compaction-marker reader (now
    // tolerant of absent entries) and a watermark helper split; both stay
    // read-only. Pin the watermark implementation and the read-only DB opener.
    'chat-history-pages-B0T-cmaS.mjs': ['1dd68da9578504fa70f8ef2a840f64d2c2473f943f27ade5fa19241c78d31197',
      '3ae1da7d5a3f5a5d02c08229501edeeb760d3dc00183a3c5125357fd57db67ba'],
    'chat-history-page-kernel-CDIy4sVj.mjs': 'f1015cf6b3d2e9373783d21d4af7dddacf99489b480f8a9f0f263b3c115cd588',
    'session-utils.fs-B4keyzHX.mjs': 'bb508c6ff50eac132c9e6ecfaff5532ab8f42e7db4d29e2d72da30a249bb9c28',
    'transcript-image-artifacts-BJipDW7F.mjs': '9bd2c2d1105e0bd464b908dd72218363c4e083ab0b9cd0c64f352cc975039c08',
    'session-accessor-DLYTHSBj.mjs': '756d3a5876376b176c2be08cc3b71b9166792e77f5d862a111e88a2acf01155e',
    'session-accessor.sqlite-transcript-watermark-read-CUQyYPNl.mjs': '92f9030a2bf3b5d9ef1b0fd9445dda8209a750b652ca1574be8c7f2eb3db1429',
    'session-cold-storage-state-BcO2Rrog.mjs': '706a21d60fbfc28803873a0ab50bf7dc72d821e94a1d4703cd2541bbd810de89',
    'openclaw-agent-db-readonly-IBx2zWDG.mjs': 'fe257d39a4cafb1a19ab275e63008ccd58545369ce00ac4d423d5d921cde5a41',
    'session-history-worker-runtime-SB0bdmLn.mjs': '200775028aedf366e8e1c309946e2d71372db9d5b816222a5002fbbb1e2d89cb',
    'runtime-process-entrypoints-DazJcPEG.mjs': '27c50af9504cd5b7b2eab19f6582ab8487a70cc069f0d50ee82983485b803532',
  }, entrypoints: ['runtime-process-entrypoints-DazJcPEG.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-B0T-cmaS.mjs', 't'],
      r: ['chat-history-page-kernel-CDIy4sVj.mjs', 'n'],
      c: ['chat-history-pages-B0T-cmaS.mjs', 'o'],
      a: ['chat-history-page-kernel-CDIy4sVj.mjs', 'i'],
    },
    readers: ['session-utils.fs-B4keyzHX.mjs', 't'],
    display: ['transcript-image-artifacts-BJipDW7F.mjs', 'i'],
    accessor: ['session-accessor-DLYTHSBj.mjs', 'l'],
  } },
  '2026.9.7': { pins: {
    // 9.7 separates the oversize budget from page reading. Cursor, compaction,
    // display, byte cap and watermark ports retain their audited 9.6 bodies.
    // Pin both the new worker barrel/implementation and read-only DB opener.
    // Stock or the separately rehearsed final-display CLI pagination repair;
    // ignoreCliSessionImports keeps this adapter on the same native path.
    'chat-history-pages-AbTJqwHl.mjs': ['009f5c4c0fa4dfe668ef017390beaffa65e8583064bd6fddf8af1b68c72af4b4',
      'ba32ab1df6c0868a0fb3a4579941b913b3da1b015211af509693d7a278213ef3'],
    'chat-history-budget-Bm4np35Y.mjs': '7a5ce3edd4b94fcc3c89844c595e58e4085e53cfb9d01623cb0d08e8d0e3c76f',
    'chat-history-page-kernel-BpQLk3GU.mjs': '026385368221fa8bb7d4033b879f80c3f2b7469f1de1f3cd7c1fc1e1ab85590b',
    'session-utils.fs-BthyrmxE.mjs': '0c4c007f23b93a909c86695d1d815c70f39e16ed075565896969615f87d40c45',
    'transcript-image-artifacts-JZUt0-cM.mjs': '4e0a3aa0ea7b7010f7c649367ce6f51c32ec1237963650da5d5f6e5427680a6e',
    'session-accessor-eyd1cdbA.mjs': '8bc980878021f82b8464a2d9ee7f2af2631d29eb93c721a0bb4971c2c80fc987',
    'session-accessor.sqlite-transcript-watermark-read-mlVTtMNn.mjs': 'e312deffcaa9250a1fd0a27c22c97fc5cf90ebd5173244e49a7ec2f36ec9ebca',
    'session-cold-storage-state-DkGnIhMN.mjs': '7849121721326ce6d3e965aef635c90926749fc8c704d528a55c273fd1f0a8db',
    'openclaw-agent-db-readonly-B_MLaWm7.mjs': 'e6f9447cfd97be1bbbf2ed7bae9171a124040ba0f8f38f1af226480e6b3adda9',
    'openclaw-agent-db-readonly-open-CZMMz-F0.mjs': 'bdcf9f5f648d32f7dcfc38bc611ac6433158e86f95f0b8f9969efb1204caa5d4',
    'openclaw-agent-db-readonly-scope-CmsUKq3x.mjs': 'a249335c0c6f3e811e4389489a7a51157617379f08e24698a077bb88f380a228',
    'session-history-worker-runtime-Bfu_6RJe.mjs': '0db43115be5a9553348c7503afc2eb1a901f229974a666b02350bfc90ef9567c',
    'session-history-worker-runtime-EkbtuSh3.mjs': 'f1c1aa03038ed012f44a99d35f3a00c0cb5aa447cc114bd35213010dbc937f3b',
    'runtime-process-entrypoints-CbWx0yUe.mjs': '57ee94d14a141173ecb4053fa9b1d549f3505c010ad157c4abc5eabbd5961143',
  }, entrypoints: ['runtime-process-entrypoints-CbWx0yUe.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-AbTJqwHl.mjs', 't'],
      r: ['chat-history-page-kernel-BpQLk3GU.mjs', 'n'],
      c: ['chat-history-budget-Bm4np35Y.mjs', 's'],
      a: ['chat-history-page-kernel-BpQLk3GU.mjs', 'i'],
    },
    readers: ['session-utils.fs-BthyrmxE.mjs', 't'],
    display: ['transcript-image-artifacts-JZUt0-cM.mjs', 'i'],
    accessor: ['session-accessor-eyd1cdbA.mjs', 'l'],
  } },
  '2026.9.8': { pins: {
    // Stock or separately reviewed CLI display-pagination repair for 9.8.
    // Selected function bodies retain the reviewed 9.7
    // contracts; read-only opener/scope and lazy worker changes are imports
    // only. Entry points retain explicit package-root override semantics.
    'chat-history-pages-UsCDs89e.mjs': ['7a2743a2427891e5d8a3422d277c4bfcf8105656905939f84962a384918d6a7b',
      '698e901d7ff1eb49bdd464654f2505d7fc38a563fe2ee8f34f22388869f5c675'],
    'chat-history-budget-zzuPoeCz.mjs': '44fcf26c351e20a60dcab1ee8043fff8dcb7bddd21ed464698f89a2bdfb9f22b',
    'chat-history-page-kernel-JYmKBTdR.mjs': '9a5462a75c02a0280ab087f9270fd7226d417208038cdd321310f31299485330',
    'session-utils.fs-D_x8Wjut.mjs': '5de4854558761696deaee0b74fa63d7f16b175ee0cb0f7decc423b1deff29aa6',
    'transcript-image-artifacts-JZUt0-cM.mjs': '4e0a3aa0ea7b7010f7c649367ce6f51c32ec1237963650da5d5f6e5427680a6e',
    'session-accessor-CGLseszP.mjs': 'ea6e771a85c7b5f7db52472c7796f99c1a3b90ab69aef6b9a008a1082458a17f',
    'session-accessor.sqlite-transcript-watermark-read-mlVTtMNn.mjs': 'e312deffcaa9250a1fd0a27c22c97fc5cf90ebd5173244e49a7ec2f36ec9ebca',
    'session-cold-storage-state-DkGnIhMN.mjs': '7849121721326ce6d3e965aef635c90926749fc8c704d528a55c273fd1f0a8db',
    'openclaw-agent-db-readonly-CkWWSfuG.mjs': 'ecf14a88691c72ed083d9b9e154b56bae8014a9c1b8c8fc1695f05a969283958',
    'openclaw-agent-db-readonly-open-BuSJ-FUr.mjs': '78e3fa476d9733187f421009a553239f4e5e877ff77b42a74b417f06d7cb0b94',
    'openclaw-agent-db-readonly-scope-CuYmDv32.mjs': '5438538a33a03fc50cdb6f66b942e4165216f3c857b522d50aeb6dfb2793a4bb',
    'session-history-worker-runtime-B-T76Mwc.mjs': 'a97769c05aa99d714ff137aaddf098e4d2644ec8445bc45b589f30253758abea',
    'session-history-worker-runtime-D_-jtlRv.mjs': '86c40016a5882f5bee92ce8f0757743849d82b1a79b017353da6153f084c95aa',
    'runtime-process-entrypoints-CbWx0yUe.mjs': '57ee94d14a141173ecb4053fa9b1d549f3505c010ad157c4abc5eabbd5961143',
  }, entrypoints: ['runtime-process-entrypoints-CbWx0yUe.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-UsCDs89e.mjs', 't'],
      r: ['chat-history-page-kernel-JYmKBTdR.mjs', 'n'],
      c: ['chat-history-budget-zzuPoeCz.mjs', 's'],
      a: ['chat-history-page-kernel-JYmKBTdR.mjs', 'i'],
    },
    readers: ['session-utils.fs-D_x8Wjut.mjs', 't'],
    display: ['transcript-image-artifacts-JZUt0-cM.mjs', 'i'],
    accessor: ['session-accessor-CGLseszP.mjs', 'l'],
  } },
  '2026.9.9': { pins: {
    // 9.9 retains native reader/cursor/display/watermark function bodies.
    // Read-only opening adds terminal/quarantine rejection, never a writer.
    // Entrypoints add stateOwnership and preserve explicit root/package overrides.
    // Stock and independently rehearsed imported CLI display-pagination repair.
    'chat-history-pages-35kBcpOJ.mjs': ['133caa7426f9fcfa19ed318c275f84157f13dae0776a3e1f4549cdff0f0ae779',
      '49668010170899ef669eb990ce4798d669446e9cf9a3b0c5703ee088816a3878',
      '4e6893db7cd22edf69ab79cbae1ec9a11e496bdce26ee44b7164fc5494785598'],
    'chat-history-budget-sdElbwez.mjs': '849747e4662edda8916f4c7092338c8abc914ca072a9eb5ece3b3e1b06684b77',
    'chat-history-page-kernel-Cm8VeNqx.mjs': '5d4b151ab5f58c0c2fc32c16165813a2351bd131f68e586a7815e0ccaad8214c',
    'session-utils.fs-x8Wdsk49.mjs': 'ac38e21b5a27f656e03d1b6333c159c93c540922e6fcafa5e803b870e4aa3fe4',
    'transcript-image-artifacts-JZUt0-cM.mjs': '4e0a3aa0ea7b7010f7c649367ce6f51c32ec1237963650da5d5f6e5427680a6e',
    'session-accessor-WMUIp1Kx.mjs': 'ee241de4a74bc1d44529b4c8ddba311ba1285147bdf965c1cb64b253d502e131',
    'session-accessor.sqlite-transcript-watermark-read-BPCdk0px.mjs': 'f494f5d1b330ec8a19eb0f1c337c8715393f225fb2b8ccfa61460c69b6e4a278',
    'session-cold-storage-state-DymPEuGu.mjs': '575ef0f7e8cf5d8093e57396094aff4376a417270774ccbcaf7f7a918b381ac6',
    'openclaw-agent-db-readonly-WugFtIYV.mjs': '905c12dfe4ab5732d2ec46884422b03433587ddd6e859cee0e51da01a4e87480',
    'openclaw-agent-db-readonly-open-CIgZIAzT.mjs': '31489aa1cc0fda16a00dae0793bd899150ef45a0c2ad5bb201f37294544095ca',
    'openclaw-agent-db-readonly-scope-DQAR5FuK.mjs': 'c0b1e392e378b9c034c04fd74e11ef85795dc1f34cab230f6e670ba806330158',
    'session-history-worker-runtime-DumpXpzh.mjs': '2c436dc9c84ffea5098dccee67f20c35784c9e9a9ccdd33b36310d7e47364d0a',
    'session-history-worker-runtime-D47dVCja.mjs': '238df34a062e9cc06594ff93d1d64218237685a1277285bd57cdda32d4200033',
    'runtime-process-entrypoints-Bh4reDp0.mjs': 'd8031c4fff5902dc7c99a70daf2d4c8f1ce809db149e029d77c0dac2873dfc4a',
  }, entrypoints: ['runtime-process-entrypoints-Bh4reDp0.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-35kBcpOJ.mjs', 't'],
      r: ['chat-history-page-kernel-Cm8VeNqx.mjs', 'n'],
      c: ['chat-history-budget-sdElbwez.mjs', 's'],
      a: ['chat-history-page-kernel-Cm8VeNqx.mjs', 'i'],
    },
    readers: ['session-utils.fs-x8Wdsk49.mjs', 't'],
    display: ['transcript-image-artifacts-JZUt0-cM.mjs', 'i'],
    accessor: ['session-accessor-WMUIp1Kx.mjs', 'l'],
  } },
};
