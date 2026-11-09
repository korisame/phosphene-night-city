@testable import AppUpdater
import Foundation
import XCTest

final class PhospheneSigningTests: XCTestCase {
    @MainActor
    func testOfficialDMGPreparationAndDiscardDoNotReplaceNativeFixture() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let nativePath = environment["PHOSPHENE_UPDATER_NATIVE_APP"],
              let vendorPath = environment["PHOSPHENE_UPDATER_VENDOR_APP"] else { throw XCTSkip("Signed fixtures required") }
        let fm = FileManager.default
        // The installer rejects every symlink component. Foundation normalizes
        // macOS temporary URLs back to /var (a symlink), even after resolution.
        // Use a unique disposable sibling under the real home directory instead.
        let root = fm.homeDirectoryForCurrentUser.appendingPathComponent(".Phosphene-Updater-Prepare-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let installedParent = root.appendingPathComponent("installed")
        let source = root.appendingPathComponent("source")
        let staging = root.appendingPathComponent("staging")
        for url in [installedParent, source, staging] { try fm.createDirectory(at: url, withIntermediateDirectories: true) }
        let installed = installedParent.appendingPathComponent("Phosphene.app")
        try fm.copyItem(atPath: nativePath, toPath: installed.path)
        try fm.copyItem(atPath: vendorPath, toPath: source.appendingPathComponent("Phosphene.app").path)
        let image = staging.appendingPathComponent(".app-updater-\(UUID().uuidString).dmg")
        _ = try await ProcessRunner.run(URL(fileURLWithPath: "/usr/bin/hdiutil"), arguments: ["create", "-quiet", "-fs", "HFS+", "-srcfolder", source.path, image.path])
        let configuration = AppUpdater.Configuration()
        let mount = try await ArchiveExtractor.mount(image, at: staging.appendingPathComponent("mounted"), expectedAppName: "Phosphene.app", limits: .init(configuration))
        XCTAssertFalse(Installation.hasSymlinkComponent(installedParent))
        let prepared = try await Installation.prepare(
            assetName: "official-fixture.dmg", lease: StagingLease(root: staging, mount: mount),
            installedBundle: try XCTUnwrap(Bundle(url: installed)), limits: .init(configuration)
        )
        // Exercise every real promotion/signature check, then explicitly stop before swap.
        await prepared.discard()
        XCTAssertEqual(try CodeSignature.installedIdentity(of: XCTUnwrap(Bundle(url: installed))), CodeSignature.phospheneNative)
        XCTAssertEqual(try fm.contentsOfDirectory(atPath: installedParent.path), ["Phosphene.app"])
    }

    @MainActor
    func testTransactionKeepsInstalledAndOfficialIdentitySeparateAndRollsBack() async throws {
        for failAfterReplace in [false, true] {
            var replaced = false
            var restored = false
            var terminated = false
            var validated: [CodeSignature.Identity] = []
            let driver = InstallationDriver(
                promote: { _, _, _ in },
                replace: { _, _, _, _ in replaced = true },
                restore: { _, _, _ in restored = true },
                remove: { _, _ in },
                validate: { _, identity in
                    validated.append(identity)
                    if replaced && failAfterReplace { throw AppUpdaterError.invalidDeveloperID }
                },
                launch: { _ in },
                terminate: { terminated = true }
            )
            let transaction = PreparedInstallation(
                assetName: "fixture.dmg",
                installedURL: URL(fileURLWithPath: "/fixture/Phosphene.app"),
                candidateURL: URL(fileURLWithPath: "/fixture/candidate/Phosphene.app"),
                promotedImageURL: URL(fileURLWithPath: "/fixture/image.dmg"),
                expectedIdentity: CodeSignature.phospheneOfficial,
                expectedInstalledIdentity: CodeSignature.phospheneNative,
                protected: false, driver: driver, cleanup: {}
            )
            do {
                try await transaction.installAndRelaunch()
                XCTAssertFalse(failAfterReplace)
            } catch { XCTAssertTrue(failAfterReplace) }
            XCTAssertEqual(validated, [CodeSignature.phospheneNative, CodeSignature.phospheneOfficial, CodeSignature.phospheneOfficial])
            XCTAssertEqual(restored, failAfterReplace)
            XCTAssertEqual(terminated, !failAfterReplace)
        }
    }

    func testPinsAreExactAndDoNotAcceptOtherPhospheneSigners() throws {
        XCTAssertEqual(try CodeSignature.expectedCandidateIdentity(for: CodeSignature.phospheneNative), CodeSignature.phospheneOfficial)
        XCTAssertEqual(try CodeSignature.expectedCandidateIdentity(for: CodeSignature.phospheneOfficial), CodeSignature.phospheneOfficial)
        for identity in [
            CodeSignature.Identity(teamIdentifier: "OTHER", signingIdentifier: "glass.kagerou.phosphene", bundleIdentifier: "glass.kagerou.phosphene"),
            CodeSignature.Identity(teamIdentifier: "52K336H235", signingIdentifier: "wrong.identifier", bundleIdentifier: "glass.kagerou.phosphene")
        ] { XCTAssertThrowsError(try CodeSignature.expectedCandidateIdentity(for: identity)) }
        let unrelated = CodeSignature.Identity(teamIdentifier: "TEAM", signingIdentifier: "other.app", bundleIdentifier: "other.app")
        XCTAssertEqual(try CodeSignature.expectedCandidateIdentity(for: unrelated), unrelated)
    }

    @MainActor
    func testActualNativeToArchivedOfficialTrustWithoutInstalling() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let nativePath = environment["PHOSPHENE_UPDATER_NATIVE_APP"],
              let vendorPath = environment["PHOSPHENE_UPDATER_VENDOR_APP"],
              let native = Bundle(path: nativePath), let vendor = Bundle(path: vendorPath) else {
            throw XCTSkip("Set paths to signed native and archived official fixture apps")
        }
        XCTAssertEqual(try CodeSignature.installedIdentity(of: native), CodeSignature.phospheneNative)
        XCTAssertEqual(try CodeSignature.validatedIdentity(of: vendor), CodeSignature.phospheneOfficial)
        XCTAssertNoThrow(try CodeSignature.requireSameDeveloperID(current: native, candidate: vendor))
        XCTAssertThrowsError(try CodeSignature.validatedIdentity(of: native))
        XCTAssertThrowsError(try CodeSignature.requireSameDeveloperID(current: native, candidate: native))
        XCTAssertNoThrow(try InstallationDriver.live.validate(native.bundleURL, CodeSignature.phospheneNative))
        XCTAssertNoThrow(try InstallationDriver.live.validate(vendor.bundleURL, CodeSignature.phospheneOfficial))
        XCTAssertThrowsError(try InstallationDriver.live.validate(native.bundleURL, CodeSignature.phospheneOfficial))
        XCTAssertThrowsError(try InstallationDriver.live.validate(vendor.bundleURL, CodeSignature.phospheneNative))

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Phosphene-Updater-Trust-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let modified = root.appendingPathComponent("Modified.app")
        try FileManager.default.copyItem(at: vendor.bundleURL, to: modified)
        let info = modified.appendingPathComponent("Contents/Info.plist")
        var data = try Data(contentsOf: info)
        data.append(0x20)
        try data.write(to: info)
        let modifiedBundle = try XCTUnwrap(Bundle(url: modified))
        XCTAssertThrowsError(try CodeSignature.requireSameDeveloperID(current: native, candidate: modifiedBundle))

        for alter in [false, true] {
            let copy = root.appendingPathComponent(alter ? "AlteredMarker.app" : "MissingMarker.app")
            try FileManager.default.copyItem(at: native.bundleURL, to: copy)
            let marker = copy.appendingPathComponent("Contents/Resources/NativeReleaseEnabled")
            if alter { try Data([0x20]).write(to: marker) }
            else { try FileManager.default.removeItem(at: marker) }
            let changed = try XCTUnwrap(Bundle(url: copy))
            XCTAssertThrowsError(try CodeSignature.installedIdentity(of: changed))
            XCTAssertThrowsError(try InstallationDriver.live.validate(copy, CodeSignature.phospheneNative))
        }

        let adHoc = root.appendingPathComponent("AdHoc.app")
        try FileManager.default.copyItem(at: native.bundleURL, to: adHoc)
        let signer = Process()
        signer.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        signer.arguments = ["--force", "--deep", "--sign", "-", adHoc.path]
        signer.standardOutput = FileHandle.nullDevice
        signer.standardError = FileHandle.nullDevice
        try signer.run()
        signer.waitUntilExit()
        XCTAssertEqual(signer.terminationStatus, 0)
        let adHocBundle = try XCTUnwrap(Bundle(url: adHoc))
        XCTAssertThrowsError(try CodeSignature.installedIdentity(of: adHocBundle))
        XCTAssertThrowsError(try CodeSignature.requireSameDeveloperID(current: native, candidate: adHocBundle))
    }
}
