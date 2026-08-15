Pod::Spec.new do |s|
  s.name           = 'InsecureNetwork'
  s.version        = '0.1.0'
  s.summary        = 'Opt-in network transport for user-configured WebDAV servers'
  s.description    = 'Performs explicitly opted-in WebDAV requests while accepting the configured host certificate on Apple platforms.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'ReadAny'
  s.homepage       = 'https://github.com/tuntuntutu/ReadAny'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.source_files   = '**/*.{h,m,swift}'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
