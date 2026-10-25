Pod::Spec.new do |s|
  s.name           = 'VimicateSharedKeychain'
  s.version        = '1.0.0'
  s.license        = 'MIT'
  s.summary        = 'Exact Security-framework bridge for Vimicate shared OpenClaw authority records'
  s.description    = 'Reads and writes the native Vimicate Keychain record shape without Expo SecureStore aliases.'
  s.author         = 'Chek Tien Tan'
  s.homepage       = 'https://github.com/chektien/vimicate'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
